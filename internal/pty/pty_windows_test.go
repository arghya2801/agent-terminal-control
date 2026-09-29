package pty

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestUTF8AcrossEveryBoundary(t *testing.T) {
	text := "hello 世界 🧪\x1b[31mred\x1b[0m"
	for cut := 0; cut <= len(text); cut++ {
		first, carry := Decode(nil, []byte(text[:cut]), false)
		second, carry := Decode(carry, []byte(text[cut:]), false)
		last, _ := Decode(carry, nil, true)
		if first+second+last != text {
			t.Fatalf("split %d: %q", cut, first+second+last)
		}
	}
	s, c := Decode(nil, []byte{0xff, 0xe2}, false)
	end, _ := Decode(c, nil, true)
	if s+end != "��" {
		t.Fatalf("bad bytes %q", s+end)
	}
}
func TestDimensions(t *testing.T) {
	for _, n := range []int{-1, 0, 1, 80, 32768} {
		if d := dimension(n); d < 1 || d > 32767 {
			t.Fatal(d)
		}
	}
}
func runPTY(t *testing.T, command string, check func(*Session, func() string)) {
	t.Helper()
	t.Setenv("ATC_SHELL_NO_PROFILE", "1")
	var mu sync.Mutex
	var output strings.Builder
	var s *Session
	ready := make(chan struct{})
	p, e := Spawn(Options{Cols: 100, Rows: 30, InitialCommand: command}, func(event Event) {
		if event.T == "o" {
			mu.Lock()
			output.WriteString(event.D)
			mu.Unlock()
			<-ready
			s.Ack(uint64(len(event.D)))
			if strings.Contains(event.D, "\x1b[6n") {
				_ = s.Write("\x1b[1;1R")
			}
		}
	})
	if e != nil {
		t.Fatal(e)
	}
	s = p
	close(ready)
	t.Cleanup(func() {
		s.Kill()
		select {
		case <-s.Done():
		case <-time.After(5 * time.Second):
			t.Error("PTY did not stop")
		}
	})
	check(s, func() string { mu.Lock(); defer mu.Unlock(); return output.String() })
}
func waitText(t *testing.T, text func() string, want string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(text(), want) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("missing %q in %q", want, text())
}
func TestRealShellOutputResizeStatsAndExit(t *testing.T) {
	runPTY(t, "Write-Output ('ATC_' + 'PTY_OK')", func(s *Session, text func() string) {
		waitText(t, text, "ATC_PTY_OK")
		if e := s.Resize(120, 40); e != nil {
			t.Fatal(e)
		}
		if st := s.Stats(); st.BytesOut == 0 || st.Sends == 0 {
			t.Fatal(st)
		}
		if e := s.Write("exit 7\r"); e != nil {
			t.Fatal(e)
		}
		select {
		case <-s.Done():
		case <-time.After(10 * time.Second):
			t.Fatal("exit not reported")
		}
	})
}
func TestBulkOutputAndUnicode(t *testing.T) {
	runPTY(t, "1..1000 | ForEach-Object { Write-Output ('ROW_' + $_) }; Write-Output ([char]0x4e16 + [string][char]0x754c)", func(s *Session, text func() string) {
		waitText(t, text, "ROW_1000")
		waitText(t, text, "世界")
		if st := s.Stats(); st.Sends >= 1000 {
			t.Fatalf("not coalesced: %v", st)
		}
	})
}
func TestBusyChildAndKill(t *testing.T) {
	runPTY(t, "ping.exe -n 30 127.0.0.1", func(s *Session, text func() string) {
		deadline := time.Now().Add(10 * time.Second)
		for s.Busy() == nil && time.Now().Before(deadline) {
			time.Sleep(25 * time.Millisecond)
		}
		if s.Busy() == nil {
			t.Fatal("running child was not detected")
		}
		s.Kill()
		select {
		case <-s.Done():
		case <-time.After(5 * time.Second):
			t.Fatal("kill did not complete")
		}
	})
}
func TestOutputBeforeExit(t *testing.T) {
	shell, e := Shell()
	if e != nil {
		t.Fatal(e)
	}
	events := make(chan Event, 100)
	s, e := Start([]string{shell, "-NoLogo", "-NoProfile", "-Command", "Write-Output ('BEFORE_' + 'EXIT'); exit 3"}, Options{Cols: 80, Rows: 24}, func(e Event) { events <- e })
	if e != nil {
		t.Fatal(e)
	}
	defer s.Kill()
	output := ""
	deadline := time.After(15 * time.Second)
	for {
		select {
		case e := <-events:
			if e.T == "o" {
				output += e.D
				s.Ack(uint64(len(e.D)))
				if strings.Contains(e.D, "\x1b[6n") {
					s.Write("\x1b[1;1R")
				}
			}
			if e.T == "x" {
				if !strings.Contains(output, "BEFORE_EXIT") || e.Code == nil || *e.Code != 3 {
					t.Fatal(fmt.Sprint(e), output)
				}
				return
			}
		case <-deadline:
			t.Fatal("no ordered exit", output)
		}
	}
}
func TestLauncherEnvironmentAndDefaultDirectory(t *testing.T) {
	for _, name := range []string{"NO_COLOR", "CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_MESSAGING_TOKEN", "CODEX_THREAD_ID"} {
		t.Setenv(name, "atc-test-marker")
	}
	runPTY(t, "$names = @('NO_COLOR','CLAUDECODE','CLAUDE_PID','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_MESSAGING_TOKEN','CODEX_THREAD_ID'); $bad = @($names | Where-Object { [Environment]::GetEnvironmentVariable($_) }); Write-Output ('ENV_' + $bad.Count); Write-Output ('TERM_' + $env:TERM); Write-Output ('HOME_' + ($PWD.Path -eq $HOME))", func(s *Session, text func() string) {
		waitText(t, text, "ENV_0")
		waitText(t, text, "TERM_xterm-256color")
		waitText(t, text, "HOME_True")
	})
}
func TestBackpressurePausesAndRecoversWithoutLoss(t *testing.T) {
	shell, err := Shell()
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	tail := ""
	s, err := Start([]string{shell, "-NoLogo", "-NoProfile", "-Command", "[Console]::Write(('x' * 3145728)); [Console]::Write('FLOW_FINISHED'); Start-Sleep -Seconds 5"}, Options{Cols: 120, Rows: 40}, func(e Event) {
		if e.T == "o" {
			mu.Lock()
			tail += e.D
			if len(tail) > 100 {
				tail = tail[len(tail)-100:]
			}
			mu.Unlock()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Kill()
	deadline := time.Now().Add(20 * time.Second)
	for s.Stats().PausedCount == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	st := s.Stats()
	if st.PausedCount == 0 || st.Inflight < 2*1024*1024 || st.Inflight > 3*1024*1024 {
		t.Fatalf("backpressure missing or unbounded: %+v", st)
	}
	for time.Now().Before(deadline) {
		s.Ack(s.Stats().Inflight)
		mu.Lock()
		finished := strings.Contains(tail, "FLOW_FINISHED")
		mu.Unlock()
		if finished {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("did not recover after acknowledgement")
}
