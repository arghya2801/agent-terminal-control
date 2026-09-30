package pty

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestConPTYFallsBackWithoutBothFiles(t *testing.T) {
	dir := t.TempDir()
	if loadConpty(dir) != nil || loadConpty("") != nil || loadConpty(".") != nil {
		t.Fatal("loaded a ConPTY that is not there")
	}
	// conpty.dll alone is not enough: it needs OpenConsole.exe beside it.
	if e := os.WriteFile(filepath.Join(dir, "conpty.dll"), nil, 0o644); e != nil {
		t.Fatal(e)
	}
	if loadConpty(dir) != nil {
		t.Fatal("loaded without OpenConsole.exe")
	}
}

// Opt-in: ATC_TEST_CONPTY names a folder holding conpty.dll and OpenConsole.exe
// (build/bin after npm run desktop:build).
func TestBundledConPTYHostsTheShellAndForwardsColourQueries(t *testing.T) {
	dir := os.Getenv("ATC_TEST_CONPTY")
	if dir == "" {
		t.Skip("set ATC_TEST_CONPTY to a folder with conpty.dll and OpenConsole.exe")
	}
	dir, _ = filepath.Abs(dir)
	was := conpty
	if conpty = loadConpty(dir); conpty == nil {
		t.Fatal("bundled ConPTY did not load from", dir)
	}
	t.Cleanup(func() { conpty = was })
	// The inbox ConPTY swallows this OSC 11 background query instead of passing it on (#81).
	runPTY(t, "Write-Output ('BUN' + 'DLED'); [Console]::Write([char]27 + ']11;?' + [char]27 + '\\')", func(s *Session, text func() string) {
		waitText(t, text, "BUNDLED")
		waitText(t, text, "\x1b]11;?")
		hosted := false
		for _, p := range Children() {
			if p.ParentProcessID == uint32(os.Getpid()) && windows.UTF16ToString(p.ExeFile[:]) == "OpenConsole.exe" {
				hosted = true
			}
		}
		if !hosted {
			t.Error("OpenConsole.exe is not hosting the shell")
		}
		if e := s.Resize(80, 20); e != nil {
			t.Fatal(e)
		}
	})
}
