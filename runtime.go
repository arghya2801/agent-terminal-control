package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"atc/internal/core"
	"golang.org/x/sys/cpu"
	"golang.org/x/sys/windows"
)

// The Bun that agent chats run on when none is on PATH. Bumping it means new hashes from
// the release's SHASUMS256.txt: `bun scripts/pin-bun.mjs <version>` prints all three.
const (
	bunVersion = "1.4.5"
	// The oldest Bun on PATH that agent chats are tested on; an older one is passed over.
	bunMin = "1.4.0"
)

type bunBuild struct{ asset, sha256 string }

var (
	bunBuilds = map[bool]bunBuild{
		true:  {"bun-windows-x64.zip", "815ab45ec7f549abf87e6869584b506eab088e24225683957b7e150b47d6de30"},
		false: {"bun-windows-x64-baseline.zip", "3c081c73865e7a3453a9d514cc2ba3d699880621bcf67bb17241ff5194cb1d4b"},
	}
	// Variables so tests can serve a release locally.
	bunURL    = "https://github.com/oven-sh/bun/releases/download/bun-v%s/%s"
	bunBuildF = func() bunBuild { return bunBuilds[cpu.X86.HasAVX2] }
	bunMu     sync.Mutex
	verifyBun = func(exe string) error {
		if v, e := bunVersionOf(exe); e != nil || v != bunVersion {
			return fmt.Errorf("the downloaded Bun didn't run (got %q, %v)", v, e)
		}
		return nil
	}
	pathBun = sync.OnceValues(func() (string, error) { return findBun(exec.LookPath) })
)

// agentRuntime is the program that runs the sidecar, from Settings > Agents > Runtime:
// auto (Bun on PATH, else ATC's own Bun, else Node on PATH), bun, node, or a path.
func (a *App) agentRuntime() (string, error) {
	choice := strings.TrimSpace(core.Str(core.Obj(a.getSettings()["agent"])["runtime"]))
	switch strings.ToLower(choice) {
	case "node":
		if node, e := exec.LookPath("node"); e == nil {
			return node, nil
		}
		return "", fmt.Errorf("Settings > Agents > Runtime is Node, and `node` is not on PATH. Install Node.js 18 or later, choose Auto, or open the session in a terminal")
	case "", "auto", "bun":
		if bun, e := pathBun(); e == nil {
			return bun, nil
		}
		bun, e := ensureBun(a.config, a.runtimeProgress())
		// Ends the chat's download line, whether the download finished or failed.
		a.emit("runtime://progress", core.Object{"received": 0, "total": 0})
		if e == nil {
			return bun, nil
		}
		if node, ne := exec.LookPath("node"); ne == nil && !strings.EqualFold(choice, "bun") {
			return node, nil
		}
		return "", fmt.Errorf("couldn't get the agent runtime: %s. Install Bun, set Settings > Agents > Runtime, or open the session in a terminal", strings.TrimSuffix(e.Error(), "."))
	default:
		if _, e := os.Stat(choice); e != nil {
			return "", fmt.Errorf("Settings > Agents > Runtime points at %s, which doesn't exist", choice)
		}
		return choice, nil
	}
}

// findBun is `bun` on PATH when it is at least bunMin.
func findBun(look func(string) (string, error)) (string, error) {
	bun, e := look("bun")
	if e != nil {
		return "", e
	}
	v, e := bunVersionOf(bun)
	if e != nil {
		return "", e
	}
	if older(v, bunMin) {
		return "", fmt.Errorf("bun %s on PATH is older than %s", v, bunMin)
	}
	return bun, nil
}

func bunVersionOf(exe string) (string, error) {
	cmd := exec.Command(exe, "--version")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	b, e := cmd.Output()
	return strings.TrimSpace(string(b)), e
}

// older compares dotted versions numerically; a pre-release suffix is ignored.
func older(v, than string) bool {
	a, b := strings.Split(strings.SplitN(v, "-", 2)[0], "."), strings.Split(than, ".")
	for i := range b {
		x, y := 0, 0
		if i < len(a) {
			x, _ = strconv.Atoi(a[i])
		}
		y, _ = strconv.Atoi(b[i])
		if x != y {
			return x < y
		}
	}
	return false
}

// runtimeProgress reports a download to the page at most four times a second.
func (a *App) runtimeProgress() func(got, total int64) {
	var last time.Time
	return func(got, total int64) {
		if got == total || time.Since(last) > 250*time.Millisecond {
			last = time.Now()
			a.emit("runtime://progress", core.Object{"received": got, "total": total})
		}
	}
}

// ensureBun returns ATC's own Bun under config, downloading and checking it first if needed.
func ensureBun(config string, progress func(got, total int64)) (string, error) {
	bunMu.Lock()
	defer bunMu.Unlock()
	dir := filepath.Join(config, "runtime", "bun-"+bunVersion)
	exe := filepath.Join(dir, "bun.exe")
	if _, e := os.Stat(exe); e == nil {
		return exe, nil
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	build := bunBuildF()
	archive := exe + ".zip.part"
	defer os.Remove(dir) // only if a failure left it empty; runs after the archive is gone
	defer os.Remove(archive)
	if e := downloadBun(fmt.Sprintf(bunURL, bunVersion, build.asset), archive, build.sha256, progress); e != nil {
		return "", e
	}
	if e := unzipOne(archive, "bun.exe", exe); e != nil {
		return "", e
	}
	if e := verifyBun(exe); e != nil {
		os.Remove(exe)
		return "", e
	}
	// Older pinned versions are no longer used; one still running stays until next time.
	old, _ := filepath.Glob(filepath.Join(config, "runtime", "bun-*"))
	for _, d := range old {
		if d != dir {
			os.RemoveAll(d)
		}
	}
	return exe, nil
}

// downloadBun is updates.go's download plus a checksum and progress.
func downloadBun(url, to, sum string, progress func(got, total int64)) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	res, e := client.Get(url)
	if e != nil {
		return fmt.Errorf("downloading Bun: %w", e)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading Bun: HTTP %d", res.StatusCode)
	}
	f, e := os.Create(to)
	if e != nil {
		return e
	}
	h := sha256.New()
	_, e = io.Copy(io.MultiWriter(f, h, &counter{total: res.ContentLength, progress: progress}), res.Body)
	if ce := f.Close(); e == nil {
		e = ce
	}
	if e != nil {
		return fmt.Errorf("downloading Bun: %w", e)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != sum {
		return fmt.Errorf("the downloaded Bun failed its checksum (got %s)", got)
	}
	return nil
}

type counter struct {
	got, total int64
	progress   func(got, total int64)
}

func (c *counter) Write(p []byte) (int, error) {
	c.got += int64(len(p))
	if c.progress != nil {
		c.progress(c.got, c.total)
	}
	return len(p), nil
}

// unzipOne copies the single entry named name, at any depth, to the fixed path to. Nothing
// else in the archive is written, so its other paths can't reach outside the folder.
func unzipOne(archive, name, to string) error {
	r, e := zip.OpenReader(archive)
	if e != nil {
		return e
	}
	defer r.Close()
	for _, f := range r.File {
		if path.Base(f.Name) != name || f.FileInfo().IsDir() {
			continue
		}
		src, e := f.Open()
		if e != nil {
			return e
		}
		defer src.Close()
		dst, e := os.Create(to + ".part")
		if e != nil {
			return e
		}
		_, e = io.Copy(dst, src)
		if ce := dst.Close(); e == nil {
			e = ce
		}
		if e != nil {
			os.Remove(to + ".part")
			return e
		}
		return os.Rename(to+".part", to)
	}
	return fmt.Errorf("the Bun archive has no %s", name)
}

// AgentRuntimeInUse is the program running the sidecar, or "" before the first chat.
func (a *App) AgentRuntimeInUse() string {
	a.agents.mu.Lock()
	defer a.agents.mu.Unlock()
	if a.agents.cmd == nil {
		return ""
	}
	return a.agents.cmd.Path
}
