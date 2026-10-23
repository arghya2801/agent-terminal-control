package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"atc/internal/core"
	"atc/internal/pty"
	"golang.org/x/sys/windows"
)

// Turn is one exchange in a transcript: a prompt, a reply, or the tools a reply called.
type Turn struct {
	Role string `json:"role"` // user, assistant or tool
	Text string `json:"text"`
}

// agentCmd runs an agent CLI by name or path without a console window. npm installs
// shims as .cmd files, which only start through a shell.
func agentCmd(ctx context.Context, exe string, args ...string) (*exec.Cmd, error) {
	path, e := exec.LookPath(exe)
	if e != nil {
		return nil, fmt.Errorf("`%s` not found", exe)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	if ext := strings.ToLower(filepath.Ext(path)); ext == ".cmd" || ext == ".bat" {
		shell, e := pty.Shell()
		if e != nil {
			return nil, e
		}
		quoted := []string{core.Quote(path)}
		for _, a := range args {
			quoted = append(quoted, core.Quote(a))
		}
		cmd = exec.CommandContext(ctx, shell, "-NoLogo", "-NoProfile", "-Command", "& "+strings.Join(quoted, " "))
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	return cmd, nil
}

// transcript checks that path is a transcript under the Claude or Codex folders, so the
// frontend cannot read arbitrary files through these commands.
func transcript(s core.Object, path string) error {
	claude, codex := core.Roots(s)
	if strings.EqualFold(filepath.Ext(path), ".jsonl") {
		for _, root := range []string{claude, codex} {
			if rel, e := filepath.Rel(root, path); e == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
				return nil
			}
		}
	}
	return fmt.Errorf("not a session transcript: %s", path)
}

// tail reads the last n bytes of a file, from the first whole line.
func tail(path string, n int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return nil, e
	}
	start := max(0, st.Size()-n)
	if _, e = f.Seek(start, io.SeekStart); e != nil {
		return nil, e
	}
	b, e := io.ReadAll(f)
	if e != nil {
		return nil, e
	}
	if start > 0 {
		if i := bytes.IndexByte(b, '\n'); i >= 0 {
			b = b[i+1:]
		}
	}
	return b, nil
}

// lineTurns is what one transcript line says, for Claude and Codex records alike.
// Injected context (command wrappers, environment blocks) is not a turn.
func lineTurns(v core.Object) []Turn {
	text := func(blocks any) (string, []string) {
		if s, ok := blocks.(string); ok {
			return s, nil
		}
		var texts, tools []string
		for _, b := range core.Arr(blocks) {
			o := core.Obj(b)
			switch core.Str(o["type"]) {
			case "text", "input_text", "output_text":
				texts = append(texts, core.Str(o["text"]))
			case "tool_use":
				tools = append(tools, core.Str(o["name"]))
			}
		}
		return strings.Join(texts, "\n"), tools
	}
	out := []Turn{}
	add := func(role, t string, tools []string) {
		if t = strings.TrimSpace(t); t != "" && !(role == "user" && strings.HasPrefix(t, "<")) {
			out = append(out, Turn{role, t})
		}
		if len(tools) > 0 {
			out = append(out, Turn{"tool", strings.Join(tools, ", ")})
		}
	}
	switch core.Str(v["type"]) {
	case "user", "assistant":
		if v["isMeta"] == true || v["isSidechain"] == true {
			break
		}
		m := core.Obj(v["message"])
		t, tools := text(m["content"])
		add(core.Str(v["type"]), t, tools)
	case "response_item":
		p := core.Obj(v["payload"])
		switch core.Str(p["type"]) {
		case "message":
			if role := core.Str(p["role"]); role == "user" || role == "assistant" {
				t, _ := text(p["content"])
				add(role, t, nil)
			}
		case "function_call", "custom_tool_call":
			add("", "", []string{core.Str(p["name"])})
		}
	}
	return out
}

// transcriptTurns reads up to the last n bytes of a transcript into turns, merging the
// tool calls of consecutive lines.
func transcriptTurns(path string, n int64) ([]Turn, error) {
	b, e := tail(path, n)
	if e != nil {
		return nil, e
	}
	turns := []Turn{}
	for _, line := range bytes.Split(b, []byte{'\n'}) {
		var v core.Object
		if json.Unmarshal(line, &v) != nil {
			continue
		}
		for _, t := range lineTurns(v) {
			if last := len(turns) - 1; t.Role == "tool" && last >= 0 && turns[last].Role == "tool" {
				turns[last].Text += ", " + t.Text
			} else if last >= 0 && turns[last] == t {
				// Claude writes one line per content block; a repeated block is the same turn.
			} else {
				turns = append(turns, t)
			}
		}
	}
	return turns, nil
}

// SessionPreview is the last few turns of a session, read without starting it (#160).
func (a *App) SessionPreview(file string) ([]Turn, error) {
	if e := transcript(a.getSettings(), file); e != nil {
		return nil, e
	}
	turns, e := transcriptTurns(file, 2<<20)
	if e != nil {
		return nil, e
	}
	return turns[max(0, len(turns)-12):], nil
}

// Hit is a transcript line that matched a search.
type Hit struct {
	Session string `json:"session"` // provider:id
	Role    string `json:"role"`
	Snippet string `json:"snippet"`
	Time    string `json:"time"`
}

// SearchTranscripts finds sessions whose prompts or replies contain query, newest first,
// one hit per session (#159).
func (a *App) SearchTranscripts(query string) ([]Hit, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	if len([]rune(q)) < 2 {
		return []Hit{}, nil
	}
	claude, codex := core.Roots(a.getSettings())
	type file struct {
		path, provider string
		mod            time.Time
	}
	files := []file{}
	add := func(provider string, paths []string) {
		for _, p := range paths {
			if st, e := os.Stat(p); e == nil {
				files = append(files, file{p, provider, st.ModTime()})
			}
		}
	}
	add("claude", core.ClaudeFiles(claude))
	add("codex", append(core.Files(filepath.Join(codex, "sessions"), true), core.Files(filepath.Join(codex, "archived_sessions"), true)...))
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	hits := []Hit{}
	for _, f := range files {
		if len(hits) >= 50 {
			break
		}
		if h, ok := searchFile(f.path, f.provider, q); ok {
			hits = append(hits, h)
		}
	}
	return hits, nil
}

func searchFile(path, provider, q string) (Hit, bool) {
	fh, e := os.Open(path)
	if e != nil {
		return Hit{}, false
	}
	defer fh.Close()
	id := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		line := sc.Bytes()
		var v core.Object
		if provider == "codex" && bytes.Contains(line, []byte(`"session_meta"`)) && json.Unmarshal(line, &v) == nil {
			id = core.Str(core.Obj(v["payload"])["id"])
		}
		// Cheap reject before parsing: the query must appear somewhere in the line.
		if !bytes.Contains(bytes.ToLower(line), []byte(q)) || json.Unmarshal(line, &v) != nil {
			continue
		}
		for _, t := range lineTurns(v) {
			if t.Role == "tool" {
				continue
			}
			lower := strings.ToLower(t.Text)
			i := strings.Index(lower, q)
			if i < 0 {
				continue
			}
			if provider == "claude" && core.Str(v["sessionId"]) != "" {
				id = core.Str(v["sessionId"])
			}
			return Hit{provider + ":" + id, t.Role, snippet(t.Text, i, len(q)), core.Str(v["timestamp"])}, true
		}
	}
	return Hit{}, false
}

// snippet is about 120 characters of text around a match at byte i, on one line.
func snippet(text string, i, n int) string {
	from, to := max(0, i-50), min(len(text), i+n+70)
	for from > 0 && !utf8Start(text[from]) {
		from--
	}
	for to < len(text) && !utf8Start(text[to]) {
		to++
	}
	s := strings.Join(strings.Fields(text[from:to]), " ")
	if from > 0 {
		s = "…" + s
	}
	if to < len(text) {
		s += "…"
	}
	return s
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }

// SuggestSessionName asks a small model for a short name for a session (#195): Claude
// Haiku through `claude -p`, or Codex Luna through `codex exec`, with no tools and no
// saved session of their own.
func (a *App) SuggestSessionName(file string) (string, error) {
	s := a.getSettings()
	if e := transcript(s, file); e != nil {
		return "", e
	}
	turns, e := transcriptTurns(file, 8<<20)
	if e != nil {
		return "", e
	}
	var b strings.Builder
	b.WriteString("Below are excerpts from a coding-agent session. Reply with only a short name for the session: 3 to 6 words, sentence case, no quotes, no trailing punctuation.\n\n")
	users := 0
	for _, t := range turns {
		if t.Role == "user" && users < 3 {
			users++
			fmt.Fprintf(&b, "User: %s\n\n", clip(t.Text, 600))
		}
	}
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "assistant" {
			fmt.Fprintf(&b, "Latest reply: %s\n", clip(turns[i].Text, 800))
			break
		}
	}
	if users == 0 {
		return "", fmt.Errorf("the session has no prompts to name it by")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := core.Str(core.Obj(s["ui"])["renameModel"])
	var cmd *exec.Cmd
	var answer string
	if model == "luna" {
		out := filepath.Join(os.TempDir(), fmt.Sprintf("atc-name-%d.txt", time.Now().UnixNano()))
		defer os.Remove(out)
		// A ChatGPT sign-in cannot use gpt-6.1-luna yet; gpt-6-luna is the same tier.
		for _, m := range []string{"gpt-6.1-luna", "gpt-6-luna"} {
			cmd, e = agentCmd(ctx, core.Str(core.Obj(s["codex"])["command"]), "exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-m", m, "-o", out, "-")
			if e != nil {
				break
			}
			_, home := core.Roots(s)
			cmd.Env = append(os.Environ(), "CODEX_HOME="+home)
			if e = run(cmd, b.String()); e == nil || !strings.Contains(e.Error(), "not supported") {
				break
			}
		}
		text, _ := os.ReadFile(out)
		answer = string(text)
	} else {
		cmd, e = agentCmd(ctx, core.Str(core.Obj(s["claude"])["command"]), "-p", "--no-session-persistence", "--model", "haiku", "--tools=", "--strict-mcp-config")
		if e == nil {
			var out bytes.Buffer
			cmd.Stdout = &out
			e = run(cmd, b.String())
			answer = out.String()
		}
	}
	if e != nil {
		return "", e
	}
	name := ""
	for _, line := range strings.Split(answer, "\n") {
		if l := strings.Trim(strings.TrimSpace(line), "\"'*`."); l != "" {
			name = l
		}
	}
	if name == "" {
		return "", fmt.Errorf("the model gave no name")
	}
	return clip(name, 60), nil
}

// run starts cmd in the temp directory, away from any project's instructions, feeds it
// stdin and waits; stderr becomes the error.
func run(cmd *exec.Cmd, stdin string) error {
	cmd.Dir = os.TempDir()
	cmd.Stdin = strings.NewReader(stdin)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if e := cmd.Run(); e != nil {
		// The end of stderr says what went wrong; the start is usually a banner. Claude
		// prints its errors (not signed in, unknown model) to stdout instead.
		msg := []rune(strings.TrimSpace(stderr.String()))
		if out, ok := cmd.Stdout.(*bytes.Buffer); ok && len(msg) == 0 {
			msg = []rune(strings.TrimSpace(out.String()))
		}
		return fmt.Errorf("%w: %s", e, string(msg[max(0, len(msg)-300):]))
	}
	return nil
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
