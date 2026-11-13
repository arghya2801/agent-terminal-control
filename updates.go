package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	wr "github.com/wailsapp/wails/v2/pkg/runtime"
)

const releaseDownloads = "https://github.com/arghya2801/agent-terminal-control/releases/download/"

type release struct {
	Tag    string `json:"tag_name"`
	URL    string `json:"html_url"`
	Assets []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func latestRelease() (release, error) {
	var r release
	c := http.Client{Timeout: 15 * time.Second}
	res, e := c.Get("https://api.github.com/repos/arghya2801/agent-terminal-control/releases/latest")
	if e != nil {
		return r, e
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return r, fmt.Errorf("GitHub answered %s", res.Status)
	}
	return r, json.NewDecoder(res.Body).Decode(&r)
}

// installKind is how this copy was installed, from where its exe lives: "msi", "setup",
// "portable", or "" for a build that should not replace itself, such as atc-dev.
func installKind(exe string) string {
	dir := filepath.Dir(exe)
	switch {
	case strings.EqualFold(dir, filepath.Join(os.Getenv("ProgramFiles"), "ATC")):
		return "msi"
	case strings.EqualFold(dir, filepath.Join(os.Getenv("LOCALAPPDATA"), "ATC")):
		return "setup"
	case strings.EqualFold(filepath.Base(exe), "atc.exe"):
		return "portable"
	}
	return ""
}

// assetURL is the release file that updates an install of this kind.
func assetURL(r release, kind string) string {
	for _, a := range r.Assets {
		ok := map[string]bool{"msi": strings.HasSuffix(a.Name, ".msi"), "setup": strings.HasSuffix(a.Name, "-setup.exe"), "portable": a.Name == "atc.exe"}[kind]
		if ok && strings.HasPrefix(a.URL, releaseDownloads) {
			return a.URL
		}
	}
	return ""
}

func download(url, file string) error {
	c := http.Client{Timeout: 10 * time.Minute}
	res, e := c.Get(url)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", res.Status)
	}
	f, e := os.Create(file)
	if e != nil {
		return e
	}
	if _, e = io.Copy(f, res.Body); e != nil {
		f.Close()
		return e
	}
	return f.Close()
}

// InstallUpdate downloads the latest release's file for this kind of install, starts it,
// and quits ATC. A portable exe is swapped in place and restarted.
func (a *App) InstallUpdate() error {
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	kind := installKind(exe)
	if kind == "" {
		return fmt.Errorf("this build cannot update itself; download the release by hand")
	}
	r, e := latestRelease()
	if e != nil {
		return e
	}
	url := assetURL(r, kind)
	if url == "" {
		return fmt.Errorf("release %s has no file for this install", r.Tag)
	}
	var cmd *exec.Cmd
	if kind == "portable" {
		// Beside the exe, so the swap is a rename on one volume.
		next, old := exe+".new", exe+".old"
		if e := download(url, next); e != nil {
			return e
		}
		_ = os.Remove(old)
		if e := os.Rename(exe, old); e != nil {
			return e
		}
		if e := os.Rename(next, exe); e != nil {
			_ = os.Rename(old, exe)
			return e
		}
		cmd = exec.Command(exe)
	} else {
		dir, e := os.MkdirTemp("", "atc-update-")
		if e != nil {
			return e
		}
		file := filepath.Join(dir, filepath.Base(url))
		if e := download(url, file); e != nil {
			return e
		}
		cmd = exec.Command(file)
		if kind == "msi" {
			cmd = exec.Command("msiexec", "/i", file)
		}
	}
	if e := cmd.Start(); e != nil {
		return e
	}
	go wr.Quit(a.ctx)
	return nil
}
