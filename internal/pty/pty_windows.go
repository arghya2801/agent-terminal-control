// Package pty provides the Windows ConPTY transport, independent of the desktop host.
package pty

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"

	"golang.org/x/sys/windows"
)

type Event struct {
	T    string  `json:"t"`
	D    string  `json:"d,omitempty"`
	Code *uint32 `json:"code,omitempty"`
	Msg  string  `json:"msg,omitempty"`
}
type Options struct {
	Cwd            string `json:"cwd"`
	Cols           int    `json:"cols"`
	Rows           int    `json:"rows"`
	InitialCommand string `json:"initialCommand"`
}
type Stats struct {
	BytesOut           uint64 `json:"bytesOut"`
	Sends              uint64 `json:"sends"`
	SendsOverThreshold uint64 `json:"sendsOverThreshold"`
	Inflight           uint64 `json:"inflight"`
	PausedCount        uint64 `json:"pausedCount"`
}
type Session struct {
	mu            sync.Mutex
	writeMu       sync.Mutex
	cond          *sync.Cond
	console       windows.Handle
	process       windows.Handle
	input, output *os.File
	PID           uint32
	closed        bool
	stats         Stats
	stop          chan struct{}
	done          chan struct{}
	once          sync.Once
}

func dimension(n int) int16 {
	if n < 1 {
		return 1
	}
	if n > 32767 {
		return 32767
	}
	return int16(n)
}
func Shell() (string, error) {
	for _, candidate := range []string{os.Getenv("ProgramFiles") + `\PowerShell\7\pwsh.exe`, "pwsh.exe", os.Getenv("SystemRoot") + `\System32\WindowsPowerShell\v1.0\powershell.exe`, "powershell.exe"} {
		if path, e := exec.LookPath(candidate); e == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("no PowerShell installation found")
}
func Spawn(opts Options, emit func(Event)) (*Session, error) {
	args, e := shellArgs()
	if e != nil {
		return nil, e
	}
	return Start(args, opts, emit)
}

// shellArgs is the interactive shell command line: PowerShell without its banner, and
// without the user's profile only when ATC_SHELL_NO_PROFILE is exactly "1".
func shellArgs() ([]string, error) {
	shell, e := Shell()
	if e != nil {
		return nil, e
	}
	args := []string{shell, "-NoLogo"}
	if os.Getenv("ATC_SHELL_NO_PROFILE") == "1" {
		args = append(args, "-NoProfile")
	}
	return args, nil
}
func Start(args []string, opts Options, emit func(Event)) (*Session, error) {
	var inRead, inWrite, outRead, outWrite windows.Handle
	if e := windows.CreatePipe(&inRead, &inWrite, nil, 0); e != nil {
		return nil, e
	}
	defer windows.CloseHandle(inRead)
	if e := windows.CreatePipe(&outRead, &outWrite, nil, 0); e != nil {
		windows.CloseHandle(inWrite)
		return nil, e
	}
	defer windows.CloseHandle(outWrite)
	s := &Session{input: os.NewFile(uintptr(inWrite), "conpty-in"), output: os.NewFile(uintptr(outRead), "conpty-out"), stop: make(chan struct{}), done: make(chan struct{})}
	s.cond = sync.NewCond(&s.mu)
	success := false
	defer func() {
		if !success {
			s.input.Close()
			s.output.Close()
			if s.console != 0 {
				windows.ClosePseudoConsole(s.console)
			}
		}
	}()
	if e := windows.CreatePseudoConsole(windows.Coord{X: dimension(opts.Cols), Y: dimension(opts.Rows)}, inRead, outWrite, 0, &s.console); e != nil {
		return nil, e
	}
	attrs, e := windows.NewProcThreadAttributeList(1)
	if e != nil {
		return nil, e
	}
	defer attrs.Delete()
	if e = pseudoConsoleAttribute(attrs.List(), s.console); e != nil {
		return nil, e
	}
	si := windows.StartupInfoEx{}
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = windows.STARTF_USESTDHANDLES
	si.ProcThreadAttributeList = attrs.List()
	command, e := windows.UTF16PtrFromString(windows.ComposeCommandLine(args))
	if e != nil {
		return nil, e
	}
	var cwd *uint16
	if st, err := os.Stat(opts.Cwd); err != nil || !st.IsDir() {
		opts.Cwd, _ = os.UserHomeDir()
	}
	if st, err := os.Stat(opts.Cwd); err == nil && st.IsDir() {
		cwd, e = windows.UTF16PtrFromString(opts.Cwd)
		if e != nil {
			return nil, e
		}
	}
	env := []string{}
	for _, v := range os.Environ() {
		k, _, _ := strings.Cut(v, "=")
		switch strings.ToUpper(k) {
		case "TERM", "NO_COLOR", "CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CODEX_THREAD_ID", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE":
			continue
		}
		env = append(env, v)
	}
	env = append(env, "TERM=xterm-256color")
	sort.Slice(env, func(i, j int) bool { return strings.ToUpper(env[i]) < strings.ToUpper(env[j]) })
	block := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	var pi windows.ProcessInformation
	if e = windows.CreateProcess(nil, command, nil, nil, false, windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_UNICODE_ENVIRONMENT, &block[0], cwd, &si.StartupInfo, &pi); e != nil {
		return nil, e
	}
	windows.CloseHandle(pi.Thread)
	s.process = pi.Process
	s.PID = pi.ProcessId
	success = true
	go s.stream(emit)
	if strings.TrimSpace(opts.InitialCommand) != "" {
		go func() {
			select {
			case <-time.After(400 * time.Millisecond):
				_ = s.Write(opts.InitialCommand + "\r")
			case <-s.stop:
			}
		}()
	}
	return s, nil
}

// Decode preserves incomplete UTF-8 between pipe reads, replacing malformed bytes.
func Decode(carry, data []byte, final bool) (string, []byte) {
	b := append(carry, data...)
	var out strings.Builder
	for len(b) > 0 {
		if !utf8.FullRune(b) && !final {
			return out.String(), append([]byte(nil), b...)
		}
		r, n := utf8.DecodeRune(b)
		if !utf8.FullRune(b) && final {
			out.WriteRune(utf8.RuneError)
			break
		}
		out.WriteRune(r)
		b = b[n:]
	}
	return out.String(), nil
}
func (s *Session) stream(emit func(Event)) {
	defer close(s.done)
	data := make(chan []byte, 16)
	readDone := make(chan struct{})
	exited := make(chan uint32, 1)
	go func() {
		defer close(readDone)
		defer close(data)
		b := make([]byte, 32*1024)
		for {
			s.mu.Lock()
			paused := false
			for s.stats.Inflight >= 2*1024*1024 && !s.closed {
				if !paused {
					s.stats.PausedCount++
					paused = true
				}
				s.cond.Wait()
			}
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return
			}
			n, e := s.output.Read(b)
			if n > 0 {
				copyB := append([]byte(nil), b[:n]...)
				select {
				case data <- copyB:
				case <-s.stop:
					return
				}
			}
			if e != nil {
				return
			}
		}
	}()
	go func() {
		windows.WaitForSingleObject(s.process, windows.INFINITE)
		var code uint32
		windows.GetExitCodeProcess(s.process, &code)
		exited <- code
	}()
	// Armed only while output is pending: an always-on ticker woke the host 125 times a second per idle terminal.
	var flushC <-chan time.Time
	var carry []byte
	var pending strings.Builder
	cprArmed := false
	flush := func(final bool) {
		if final {
			last, _ := Decode(carry, nil, true)
			pending.WriteString(last)
			carry = nil
		}
		text := pending.String()
		pending.Reset()
		for _, piece := range splitForIPC(text, chunkBudget) {
			s.mu.Lock()
			s.stats.BytesOut += uint64(len(piece))
			s.stats.Inflight += uint64(len(piece))
			s.stats.Sends++
			s.mu.Unlock()
			emit(Event{T: "o", D: piece})
			if !cprArmed && strings.Contains(piece, "\x1b[6n") {
				cprArmed = true
				before := s.Stats().BytesOut
				go func() {
					select {
					case <-time.After(1200 * time.Millisecond):
						if s.Stats().BytesOut == before {
							_ = s.Write("\x1b[1;1R")
						}
					case <-s.done:
					}
				}()
			}
		}
	}
	consume := func(b []byte) { txt, rest := Decode(carry, b, false); carry = rest; pending.WriteString(txt) }
	for {
		select {
		case b, ok := <-data:
			if !ok {
				data = nil
			} else {
				consume(b)
				if flushC == nil {
					flushC = time.After(8 * time.Millisecond)
				}
			}
		case <-flushC:
			flushC = nil
			flush(false)
		case code := <-exited:
			// Drain output before publishing exit. Closing ConPTY is done off the reader thread.
			go s.closeConsole()
			timer := time.NewTimer(200 * time.Millisecond)
		drain:
			for {
				select {
				case b, ok := <-data:
					if !ok {
						break drain
					}
					consume(b)
				case <-timer.C:
					break drain
				}
			}
			timer.Stop()
			flush(true)
			emit(Event{T: "x", Code: &code})
			s.cleanup()
			return
		case <-s.stop:
			flush(true)
			s.cleanup()
			return
		}
	}
}
func (s *Session) closeConsole() {
	s.mu.Lock()
	h := s.console
	s.console = 0
	s.mu.Unlock()
	if h != 0 {
		windows.ClosePseudoConsole(h)
	}
}
func (s *Session) cleanup() {
	s.mu.Lock()
	s.closed = true
	s.cond.Broadcast()
	s.mu.Unlock()
	close(s.stop) // releases a reader blocked on `data` once stream has stopped draining it
	s.input.Close()
	s.output.Close()
	windows.CloseHandle(s.process)
}
func (s *Session) Write(data string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, e := s.input.Write([]byte(data))
	return e
}
func (s *Session) Resize(cols, rows int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.console == 0 {
		return fmt.Errorf("terminal has exited")
	}
	return windows.ResizePseudoConsole(s.console, windows.Coord{X: dimension(cols), Y: dimension(rows)})
}
func (s *Session) Ack(n uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if n > s.stats.Inflight {
		n = s.stats.Inflight
	}
	s.stats.Inflight -= n
	if s.stats.Inflight <= 256*1024 {
		s.cond.Broadcast()
	}
}
func (s *Session) Stats() Stats { s.mu.Lock(); defer s.mu.Unlock(); return s.stats }
func (s *Session) Kill() {
	s.once.Do(func() {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return
		}
		s.closed = true
		s.cond.Broadcast()
		s.mu.Unlock()
		KillTree(s.PID)
		windows.TerminateProcess(s.process, 1)
		go s.closeConsole()
	})
}
func (s *Session) Done() <-chan struct{} { return s.done }
func Children() []windows.ProcessEntry32 {
	h, e := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if e != nil {
		return nil
	}
	defer windows.CloseHandle(h)
	out := []windows.ProcessEntry32{}
	v := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for e = windows.Process32First(h, &v); e == nil; e = windows.Process32Next(h, &v) {
		out = append(out, v)
	}
	return out
}
func (s *Session) Busy() any {
	for _, p := range Children() {
		if p.ParentProcessID == s.PID && p.ProcessID != s.PID {
			return windows.UTF16ToString(p.ExeFile[:])
		}
	}
	return nil
}
func KillTree(pid uint32) {
	entries := Children()
	var kill func(uint32)
	kill = func(id uint32) {
		for _, p := range entries {
			if p.ParentProcessID == id && p.ProcessID != id {
				kill(p.ProcessID)
			}
		}
		if h, e := windows.OpenProcess(windows.PROCESS_TERMINATE, false, id); e == nil {
			windows.TerminateProcess(h, 1)
			windows.CloseHandle(h)
		}
	}
	kill(pid)
}
func JobBlocksBreakaway() bool {
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	e := windows.QueryInformationJobObject(0, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil)
	return e == nil && info.BasicLimitInformation.LimitFlags&(windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK|windows.JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK) == 0
}

var nextID atomic.Uint64

func ID() string { return fmt.Sprintf("pty-%d", nextID.Add(1)) }

// This attribute takes a HANDLE value, not a Go pointer.
func pseudoConsoleAttribute(list *windows.ProcThreadAttributeList, console windows.Handle) error {
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("UpdateProcThreadAttribute")
	ok, _, err := proc.Call(uintptr(unsafe.Pointer(list)), 0, windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(console), unsafe.Sizeof(console), 0, 0)
	if ok == 0 {
		return err
	}
	return nil
}
