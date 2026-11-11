package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"atc/internal/core"
	"atc/internal/pty"
	"golang.org/x/sys/windows"
)

// Agent sessions run in one Node process, the sidecar in sidecar/agent.ts, which drives
// Claude through the Agent SDK and Codex through `codex app-server`. Go starts it with the
// first session, gives each session the CLI and arguments from settings, and routes the
// sidecar's lines to that session's channel.
type sidecar struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	channels map[string]string        // session id -> its event channel
	closing  map[string]chan struct{} // sessions AgentClose is waiting on, closed at their exit
}

var nextAgent atomic.Uint64

// AgentOpen starts a Claude or Codex session in cwd, resuming session when it is set, and
// streams its events on channel. chat adds the chat arguments; model and effort, when set,
// choose them for the session; account is the Claude account it runs as.
func (a *App) AgentOpen(provider, cwd, session string, chat bool, model, effort, account, channel string) (string, error) {
	op, e := a.launch(provider, cwd, chat, account)
	if e != nil {
		return "", e
	}
	op["op"], op["resume"], op["model"], op["effort"] = "open", session, model, effort
	return a.agents.send(a, op, channel)
}

// AgentCatalog lists a provider's models on channel, then exits, without starting a
// session. The sidecar asks each CLI once.
func (a *App) AgentCatalog(provider, channel string) error {
	op, e := a.launch(provider, core.Home(), false, a.defaultAccount())
	if e != nil {
		return e
	}
	op["op"] = "catalog"
	_, e = a.agents.send(a, op, channel)
	return e
}

// launch is what starting provider in cwd takes: the CLI from settings, its arguments,
// and Codex's home.
func (a *App) launch(provider, cwd string, chat bool, account string) (core.Object, error) {
	if provider != "claude" && provider != "codex" {
		return nil, fmt.Errorf("unknown provider: %s", provider)
	}
	s := a.getSettings()
	cfg := core.Obj(s[provider])
	exe, e := agentExe(provider, core.Str(cfg["command"]))
	if e != nil {
		return nil, e
	}
	args := []string{}
	for _, k := range []string{"args", "chatArgs"} {
		if k == "args" || chat {
			for _, v := range core.Arr(cfg[k]) {
				args = append(args, core.Str(v))
			}
		}
	}
	env := map[string]string{}
	if _, home := core.Roots(s); provider == "codex" && strings.TrimSpace(core.Str(cfg["homeDir"])) != "" {
		env["CODEX_HOME"] = home
	}
	if provider == "claude" && cfg["atcLabel"] != false {
		env["CLAUDE_CODE_ENTRYPOINT"] = "atc"
	}
	if provider == "claude" {
		for k, v := range a.accountEnv(account) {
			env[k] = v
		}
	}
	if !core.IsDir(cwd) {
		cwd = core.Home()
	}
	return core.Object{"provider": provider, "cwd": cwd, "exe": exe, "args": args, "env": env}, nil
}

// send gives op a fresh id whose events go to channel, and writes it.
func (s *sidecar) send(a *App, op core.Object, channel string) (string, error) {
	if e := s.start(a); e != nil {
		return "", e
	}
	id := fmt.Sprintf("agent-%d", nextAgent.Add(1))
	s.mu.Lock()
	s.channels[id] = channel
	s.mu.Unlock()
	op["id"] = id
	if e := s.write(op); e != nil {
		s.mu.Lock()
		delete(s.channels, id)
		s.mu.Unlock()
		return "", e
	}
	return id, nil
}

// AgentSend passes one operation to a session: send, interrupt, answer, mode, model or
// effort.
func (a *App) AgentSend(id string, op core.Object) error {
	switch core.Str(op["op"]) {
	case "send", "interrupt", "stopTask", "btw", "answer", "mode", "model", "effort", "rewind", "files", "wake":
	default:
		return fmt.Errorf("unknown agent operation: %v", op["op"])
	}
	a.agents.mu.Lock()
	_, live := a.agents.channels[id]
	a.agents.mu.Unlock()
	if !live {
		return fmt.Errorf("this session has ended; Resume it to keep going")
	}
	op["id"] = id
	return a.agents.write(op)
}

// AgentClose ends a session and returns once its CLI has exited, or after 5 seconds: a
// terminal resuming the session next must not find it still held (#227). The session
// stays on disk to resume.
func (a *App) AgentClose(id string) error {
	s, done := &a.agents, make(chan struct{})
	s.mu.Lock()
	delete(s.channels, id)
	if s.closing == nil {
		s.closing = map[string]chan struct{}{}
	}
	s.closing[id] = done
	s.mu.Unlock()
	e := s.write(core.Object{"op": "close", "id": id})
	if e == nil {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
	}
	s.mu.Lock()
	delete(s.closing, id)
	s.mu.Unlock()
	return e
}

// agentExe is the CLI a session runs. npm installs both CLIs as .cmd shims: the SDK cannot
// start Claude's, and cmd.exe would reparse Codex's arguments, so each gets its script.
func agentExe(provider, command string) (string, error) {
	path, e := exec.LookPath(command)
	if e != nil {
		return "", fmt.Errorf("`%s` not found. Set its path in Settings > Agents", command)
	}
	script := map[string]string{"claude": "@anthropic-ai/claude-code/cli.js", "codex": "@openai/codex/bin/codex.js"}[provider]
	if strings.EqualFold(filepath.Ext(path), ".cmd") {
		if js := filepath.Join(filepath.Dir(path), "node_modules", filepath.FromSlash(script)); func() bool { _, e := os.Stat(js); return e == nil }() {
			return js, nil
		}
	}
	return path, nil
}

func (s *sidecar) start(a *App) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil {
		return nil
	}
	node, e := exec.LookPath("node")
	if e != nil {
		return fmt.Errorf("Agent sessions need Node.js 18 or later. Install it from https://nodejs.org, or open the session in a terminal")
	}
	script := os.Getenv("ATC_SIDECAR")
	if script == "" {
		if script, e = extractSidecar(a.config); e != nil {
			return e
		}
	}
	cmd := exec.Command(node, script)
	cmd.Env = pty.ChildEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	// The last run's log says why it stopped; the next chat or Resume starts a new one.
	logPath := filepath.Join(a.config, "sidecar.log")
	_ = os.Rename(logPath, filepath.Join(a.config, "sidecar.old.log"))
	logFile, e := os.Create(logPath)
	if e != nil {
		cmd.Stderr = io.Discard
	} else {
		// The child has its own handle once started; holding ours keeps the next rename from working.
		cmd.Stderr = logFile
		defer logFile.Close()
	}
	stdin, e := cmd.StdinPipe()
	if e != nil {
		return e
	}
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		return e
	}
	if e = cmd.Start(); e != nil {
		return fmt.Errorf("starting the agent sidecar: %w", e)
	}
	s.cmd, s.stdin = cmd, stdin
	if s.channels == nil {
		s.channels = map[string]string{}
	}
	go s.read(a, cmd, stdout)
	return nil
}

// read routes each `{id, ev}` line to its session's channel. When the sidecar dies, every
// session hears about it and the next session starts a new one.
func (s *sidecar) read(a *App, cmd *exec.Cmd, stdout io.Reader) {
	r := bufio.NewReader(stdout)
	for {
		line, e := r.ReadBytes('\n')
		var m struct {
			ID string          `json:"id"`
			Ev json.RawMessage `json:"ev"`
		}
		var ev struct {
			T string `json:"t"`
		}
		if json.Unmarshal(line, &m) == nil {
			s.mu.Lock()
			channel := s.channels[m.ID]
			// A session's last event: nothing more goes to its channel.
			if json.Unmarshal(m.Ev, &ev) == nil && ev.T == "exit" {
				delete(s.channels, m.ID)
				if done, ok := s.closing[m.ID]; ok {
					close(done)
					delete(s.closing, m.ID)
				}
			}
			s.mu.Unlock()
			if channel != "" {
				a.emit(channel, m.Ev)
			}
		}
		if e != nil {
			break
		}
	}
	cmd.Wait()
	s.mu.Lock()
	// After stop, a newer sidecar may own the state; this one's end must not wipe it (#226).
	var gone map[string]string
	if s.cmd == cmd {
		gone = s.channels
		s.cmd, s.stdin, s.channels = nil, nil, map[string]string{}
		s.releaseClosing()
	}
	s.mu.Unlock()
	for _, channel := range gone {
		a.emit(channel, core.Object{"t": "exit", "message": "The agent sidecar stopped. sidecar.log in the config folder says why."})
	}
}

func (s *sidecar) write(v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stdin == nil {
		return fmt.Errorf("the agent sidecar is not running")
	}
	_, e = s.stdin.Write(append(b, '\n'))
	return e
}

// stop ends every session: closing stdin lets the sidecar close them, then whatever is
// left of its process tree goes.
func (s *sidecar) stop() {
	s.mu.Lock()
	cmd, stdin := s.cmd, s.stdin
	// Cleared now, not when read sees the exit: an AgentOpen meanwhile starts a new sidecar
	// instead of writing to this one's closed pipe (#226).
	s.cmd, s.stdin, s.channels = nil, nil, map[string]string{}
	s.releaseClosing()
	s.mu.Unlock()
	if cmd == nil {
		return
	}
	stdin.Close()
	done := make(chan struct{})
	go func() { cmd.Process.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
	// A CLI that outlived Node still names it as its parent.
	pty.KillTree(uint32(cmd.Process.Pid))
}

// releaseClosing lets every waiting AgentClose return. Call with mu held.
func (s *sidecar) releaseClosing() {
	for _, done := range s.closing {
		close(done)
	}
	s.closing = nil
}

// extractSidecar writes the embedded sidecar into the config folder, where Node can run
// it, unless the copy there is already current.
func extractSidecar(config string) (string, error) {
	b, e := fs.ReadFile(assets, "dist/sidecar/agent.mjs")
	if e != nil {
		return "", fmt.Errorf("this build has no agent sidecar; build it with npm run build")
	}
	path := filepath.Join(config, "sidecar", "agent.mjs")
	if old, e := os.ReadFile(path); e == nil && bytes.Equal(old, b) {
		return path, nil
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return "", e
	}
	return path, core.WriteFile(path, b)
}
