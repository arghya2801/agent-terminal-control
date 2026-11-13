package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestUpdatePicksTheFileForEachInstall(t *testing.T) {
	t.Setenv("ProgramFiles", `C:\Program Files`)
	t.Setenv("LOCALAPPDATA", `C:\Users\u\AppData\Local`)
	for exe, want := range map[string]string{
		`C:\Program Files\ATC\atc.exe`:         "msi",
		`C:\Users\u\AppData\Local\ATC\atc.exe`: "setup",
		`D:\tools\atc.exe`:                     "portable",
		`D:\code\atc\build\bin\atc-dev.exe`:    "",
	} {
		if got := installKind(filepath.Clean(exe)); got != want {
			t.Errorf("%s: got %q, want %q", exe, got, want)
		}
	}
	var r release
	json.Unmarshal([]byte(`{"assets":[
		{"name":"ATC_0.8.0_x64_en-US.msi","browser_download_url":"`+releaseDownloads+`v0.8.0/ATC_0.8.0_x64_en-US.msi"},
		{"name":"ATC_0.8.0_x64-setup.exe","browser_download_url":"`+releaseDownloads+`v0.8.0/ATC_0.8.0_x64-setup.exe"},
		{"name":"atc.exe","browser_download_url":"https://example.com/atc.exe"}]}`), &r)
	if got := assetURL(r, "msi"); got != releaseDownloads+"v0.8.0/ATC_0.8.0_x64_en-US.msi" {
		t.Error(got)
	}
	if got := assetURL(r, "setup"); got != releaseDownloads+"v0.8.0/ATC_0.8.0_x64-setup.exe" {
		t.Error(got)
	}
	if got := assetURL(r, "portable"); got != "" {
		t.Errorf("a file from outside the repository's releases: %s", got)
	}
}
