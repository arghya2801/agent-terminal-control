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
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

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
		if t = strings.TrimSpace(t); t != "" && !(role == "user" && (strings.HasPrefix(t, "<") || strings.HasPrefix(t, "# AGENTS.md instructions"))) {
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
// one hit per session (#159). A search the user has typed past stops scanning (#229).
func (a *App) SearchTranscripts(query string) ([]Hit, error) {
	this := a.searches.Add(1)
	q := strings.TrimSpace(query)
	if len([]rune(q)) < 2 {
		return []Hit{}, nil
	}
	s := newSearch(q)
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
		if len(hits) >= 50 || a.searches.Load() != this {
			break
		}
		if h, ok := s.file(f.path, f.provider); ok {
			hits = append(hits, h)
		}
	}
	return hits, nil
}

// search holds one query's matcher and the buffers reused across its files.
type search struct {
	re       *regexp.Regexp
	needles  [][]byte // lowercased query, raw and as escaped inside a JSON string
	buf, low []byte
}

func newSearch(q string) *search {
	var esc bytes.Buffer
	enc := json.NewEncoder(&esc)
	enc.SetEscapeHTML(false)
	enc.Encode(q)
	e := strings.TrimSpace(esc.String())
	return &search{re: regexp.MustCompile("(?i)" + regexp.QuoteMeta(q)), needles: [][]byte{[]byte(strings.ToLower(q)), []byte(strings.ToLower(e[1 : len(e)-1]))}, buf: make([]byte, 1<<20)}
}

// lower lowercases line into s.low, copying only lines with non-ASCII bytes.
func (s *search) lower(line []byte) []byte {
	s.low = s.low[:0]
	for _, c := range line {
		if c >= utf8.RuneSelf {
			return bytes.ToLower(line)
		}
		if 'A' <= c && c <= 'Z' {
			c += 'a' - 'A'
		}
		s.low = append(s.low, c)
	}
	return s.low
}

func (s *search) file(path, provider string) (Hit, bool) {
	fh, e := os.Open(path)
	if e != nil {
		return Hit{}, false
	}
	defer fh.Close()
	id := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	sc := bufio.NewScanner(fh)
	sc.Buffer(s.buf, 64<<20)
	for sc.Scan() {
		line := sc.Bytes()
		var v core.Object
		if provider == "codex" && bytes.Contains(line, []byte(`"session_meta"`)) && json.Unmarshal(line, &v) == nil {
			id = core.Str(core.Obj(v["payload"])["id"])
		}
		// Cheap reject before parsing: the query must appear somewhere in the line.
		low := s.lower(line)
		if !bytes.Contains(low, s.needles[0]) && !bytes.Contains(low, s.needles[1]) || json.Unmarshal(line, &v) != nil {
			continue
		}
		for _, t := range lineTurns(v) {
			if t.Role == "tool" {
				continue
			}
			m := s.re.FindStringIndex(t.Text)
			if m == nil {
				continue
			}
			if provider == "claude" && core.Str(v["sessionId"]) != "" {
				id = core.Str(v["sessionId"])
			}
			return Hit{provider + ":" + id, t.Role, snippet(t.Text, m[0], m[1]-m[0]), core.Str(v["timestamp"])}, true
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
		answer, e = a.haiku(ctx, b.String())
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

// haiku sends prompt to Claude Haiku through `claude -p`, with no tools and no saved session.
func (a *App) haiku(ctx context.Context, prompt string) (string, error) {
	cmd, e := agentCmd(ctx, core.Str(core.Obj(a.getSettings()["claude"])["command"]), "-p", "--no-session-persistence", "--model", "haiku", "--tools=", "--strict-mcp-config")
	if e != nil {
		return "", e
	}
	cmd.Env = append(os.Environ(), envList(a.accountEnv(a.defaultAccount()))...)
	var out bytes.Buffer
	cmd.Stdout = &out
	e = run(cmd, prompt)
	return out.String(), e
}

// WarmClaude sends Haiku a greeting so the 5-hour limit window starts (#310).
func (a *App) WarmClaude() error {
	if acc, ok := a.account(a.defaultAccount()); ok && acc.Kind != "oauth" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	_, e := a.haiku(ctx, "hello")
	return e
}

// RenameSession gives a Claude session a title, the way /rename does: a custom-title line
// appended to its transcript (#295).
func (a *App) RenameSession(file, name string) error {
	s := a.getSettings()
	if e := transcript(s, file); e != nil {
		return e
	}
	claude, _ := core.Roots(s)
	if rel, e := filepath.Rel(claude, file); e != nil || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("only Claude sessions can be renamed here")
	}
	if name = strings.TrimSpace(name); name == "" {
		return fmt.Errorf("the name is empty")
	}
	line, _ := json.Marshal(map[string]string{"type": "custom-title", "customTitle": name, "sessionId": strings.TrimSuffix(filepath.Base(file), ".jsonl")})
	st, e := os.Stat(file)
	if e != nil {
		return e
	}
	f, e := os.OpenFile(file, os.O_APPEND|os.O_RDWR, 0)
	if e != nil {
		return e
	}
	defer f.Close()
	out := append(line, '\n')
	if last := make([]byte, 1); st.Size() > 0 {
		if _, e = f.ReadAt(last, st.Size()-1); e != nil {
			return e
		}
		if last[0] != '\n' {
			out = append([]byte{'\n'}, out...)
		}
	}
	if _, e = f.Write(out); e != nil {
		return e
	}
	// Recency stays what the agent last wrote, so a rename does not move the session.
	return os.Chtimes(file, time.Now(), st.ModTime())
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
