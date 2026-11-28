package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"atc/internal/core"
)

// fakeRelease serves a zip holding bun.exe plus entries that must never be written, and
// points the downloader at it. sum overrides the pinned hash when set.
func fakeRelease(t *testing.T, sum string) (requests *atomic.Int32) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range map[string]string{"../evil.txt": "x", "bun-windows-x64/": "", "bun-windows-x64/bun.exe": "fake bun"} {
		f, _ := w.Create(name)
		f.Write([]byte(body))
	}
	w.Close()
	h := sha256.Sum256(buf.Bytes())
	if sum == "" {
		sum = hex.EncodeToString(h[:])
	}
	requests = &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write(buf.Bytes())
	}))
	t.Cleanup(srv.Close)
	url, build, verify := bunURL, bunBuildF, verifyBun
	t.Cleanup(func() { bunURL, bunBuildF, verifyBun = url, build, verify })
	bunURL = srv.URL + "/%s/%s"
	bunBuildF = func() bunBuild { return bunBuild{"bun.zip", sum} }
	verifyBun = func(string) error { return nil }
	return requests
}

func TestEnsureBunDownloadsOnceAndWritesOnlyBunExe(t *testing.T) {
	config := t.TempDir()
	requests := fakeRelease(t, "")
	old := filepath.Join(config, "runtime", "bun-0.0.1")
	os.MkdirAll(old, 0700)
	var last [2]int64
	exe, e := ensureBun(config, func(got, total int64) { last = [2]int64{got, total} })
	if e != nil {
		t.Fatal(e)
	}
	if b, _ := os.ReadFile(exe); string(b) != "fake bun" || exe != filepath.Join(config, "runtime", "bun-"+bunVersion, "bun.exe") {
		t.Fatalf("%s: %q", exe, b)
	}
	if last[0] == 0 || last[0] != last[1] {
		t.Fatalf("progress ended at %v", last)
	}
	filepath.Walk(config, func(p string, i os.FileInfo, _ error) error {
		if strings.Contains(p, "evil") || strings.HasSuffix(p, ".part") {
			t.Errorf("left behind %s", p)
		}
		return nil
	})
	if _, e := os.Stat(old); e == nil {
		t.Error("kept an older pinned Bun")
	}
	if again, e := ensureBun(config, nil); e != nil || again != exe || requests.Load() != 1 {
		t.Fatalf("second call: %s %v, %d requests", again, e, requests.Load())
	}
}

func TestEnsureBunRejectsABadChecksum(t *testing.T) {
	config := t.TempDir()
	fakeRelease(t, strings.Repeat("0", 64))
	if _, e := ensureBun(config, nil); e == nil || !strings.Contains(e.Error(), "checksum") {
		t.Fatalf("got %v", e)
	}
	if _, e := os.Stat(filepath.Join(config, "runtime", "bun-"+bunVersion)); e == nil {
		t.Fatal("left the version folder behind")
	}
}

func TestEnsureBunDownloadsOnceForConcurrentChats(t *testing.T) {
	config := t.TempDir()
	requests := fakeRelease(t, "")
	var wg sync.WaitGroup
	for range 5 {
		wg.Add(1)
		go func() { defer wg.Done(); ensureBun(config, nil) }()
	}
	wg.Wait()
	if n := requests.Load(); n != 1 {
		t.Fatalf("%d downloads", n)
	}
}

func TestOlder(t *testing.T) {
	for _, c := range []struct {
		v, min string
		want   bool
	}{{"1.3.14", "1.4.0", true}, {"1.4.0", "1.4.0", false}, {"1.4.5", "1.4.0", false}, {"1.4.0-canary.1", "1.4.0", false}, {"2.0", "1.4.0", false}, {"1.4", "1.4.1", true}} {
		if got := older(c.v, c.min); got != c.want {
			t.Errorf("older(%s, %s) = %v", c.v, c.min, got)
		}
	}
}

func TestAgentRuntimeOrder(t *testing.T) {
	bin := t.TempDir()
	node := filepath.Join(bin, "node.exe")
	os.WriteFile(node, nil, 0700)
	t.Setenv("PATH", bin)
	fakeRelease(t, strings.Repeat("0", 64)) // every download fails its checksum
	find := pathBun
	t.Cleanup(func() { pathBun = find })
	pathBun = func() (string, error) { return "", errors.New("no bun") }
	a := NewApp(t.TempDir())
	runtime := func(choice string) (string, error) {
		a.settings = core.Defaults()
		core.Obj(a.settings["agent"])["runtime"] = choice
		return a.agentRuntime()
	}
	if got, e := runtime("auto"); e != nil || !strings.EqualFold(got, node) {
		t.Errorf("auto with no Bun and a failed download: %s %v", got, e)
	}
	if _, e := runtime("bun"); e == nil || strings.Contains(e.Error(), "..") {
		t.Errorf("bun with no Bun and a failed download: %v", e)
	}
	if got, e := runtime(node); e != nil || got != node {
		t.Errorf("a path: %s %v", got, e)
	}
	if _, e := runtime(filepath.Join(bin, "missing.exe")); e == nil {
		t.Error("a missing path was accepted")
	}
	pathBun = func() (string, error) { return `C:\bun\bun.exe`, nil }
	if got, _ := runtime("auto"); got != `C:\bun\bun.exe` {
		t.Errorf("auto preferred %s over Bun on PATH", got)
	}
	if got, _ := runtime("node"); !strings.EqualFold(got, node) {
		t.Errorf("node chose %s", got)
	}
}
