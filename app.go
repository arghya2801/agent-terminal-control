package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"atc/internal/core"
	"atc/internal/pty"
	"github.com/fsnotify/fsnotify"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type App struct {
	pageID       string
	diskMu       sync.Mutex
	watchMu      sync.Mutex
	ctx          context.Context
	config       string
	mu           sync.Mutex
	settings     core.Object
	notes        string
	ptys         map[string]*pty.Session
	index        core.Index
	costs        core.Costs
	limits       limitsClient
	history      limitHistory
	watcher      *fsnotify.Watcher
	cancel       context.CancelFunc
	lastIndex    string
	lastSettings string
	agents       sidecar
}

func NewApp(config string) *App {
	return &App{config: config, ptys: map[string]*pty.Session{}, index: core.Index{CachePath: filepath.Join(config, "index-go.json")}}
}
func (a *App) startup(ctx context.Context) {
	a.ctx, a.cancel = context.WithCancel(ctx)
	a.load()
	_ = os.MkdirAll(a.config, 0700)
	go core.RefreshPrices(a.config)
	a.watcher, _ = fsnotify.NewWatcher()
	if a.watcher != nil {
		a.arm()
		go a.watch()
	}
}
func (a *App) ready(ctx context.Context) { _ = wr.InitializeNotifications(ctx) }
func (a *App) shutdown(ctx context.Context) {
	a.cancel()
	if a.watcher != nil {
		a.watcher.Close()
	}
	a.limits.stop()
	a.agents.stop()
	a.killAll()
	wr.CleanupNotifications(ctx)
}

// killAll ends every terminal, waiting briefly for each to finish.
func (a *App) killAll() {
	a.mu.Lock()
	sessions := []*pty.Session{}
	for id, p := range a.ptys {
		sessions = append(sessions, p)
		delete(a.ptys, id)
	}
	a.mu.Unlock()
	for _, p := range sessions {
		p.Kill()
	}
	for _, p := range sessions {
		select {
		case <-p.Done():
		case <-time.After(2 * time.Second):
		}
	}
}
func (a *App) load() {
	path := filepath.Join(a.config, "settings.json")
	if os.Getenv("ATC_CONFIG_DIR") == "" {
		for _, old := range []string{"dev.arghya.atc", "dev.arghya.ccpg"} {
			if core.MigrateSettings(filepath.Join(filepath.Dir(a.config), old), a.config) {
				break
			}
		}
	}
	a.settings, _ = core.LoadSettings(path)
	a.lastSettings = jsonText(a.settings)
	// Tasks were retired for notes.md (#132). Copy them over once; tasks.json stays on disk.
	notes := filepath.Join(a.config, "notes.md")
	if _, e := os.Stat(notes); os.IsNotExist(e) {
		if text := core.LegacyNotes(a.config); text != "" {
			_ = core.WriteFile(notes, []byte(text))
		}
	}
	b, _ := os.ReadFile(notes)
	a.notes = string(b)
}
func jsonText(v any) string { b, _ := json.Marshal(v); return string(b) }
func (a *App) getSettings() core.Object {
	a.mu.Lock()
	defer a.mu.Unlock()
	return core.Obj(core.Clone(a.settings))
}
func (a *App) emit(name string, value any) {
	if a.ctx != nil {
		wr.EventsEmit(a.ctx, name, value)
	}
}
func (a *App) arm() {
	if a.watcher == nil {
		return
	}
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	s := a.getSettings()
	c, x := core.Roots(s)
	desired := map[string]bool{}
	for _, target := range []struct {
		path      string
		recursive bool
	}{{a.config, false}, {c, true}, {x, false}, {filepath.Join(x, "sessions"), true}} {
		root := target.path
		if !core.IsDir(root) {
			for !core.IsDir(root) {
				parent := filepath.Dir(root)
				if parent == root {
					break
				}
				root = parent
			}
			desired[root] = true
			continue
		}
		desired[root] = true
		if target.recursive {
			_ = filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
				if e == nil && d.IsDir() {
					desired[p] = true
				}
				return nil
			})
		}
	}
	existing := map[string]bool{}
	for _, p := range a.watcher.WatchList() {
		existing[p] = true
		if !desired[p] {
			_ = a.watcher.Remove(p)
		}
	}
	for p := range desired {
		if !existing[p] {
			_ = a.watcher.Add(p)
		}
	}
}
func (a *App) watch() {
	var timer *time.Timer
	var tick <-chan time.Time
	for {
		select {
		case <-a.ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case _, ok := <-a.watcher.Errors:
			if !ok {
				return
			}
		case e, ok := <-a.watcher.Events:
			if !ok {
				return
			}
			if e.Has(fsnotify.Create) && core.IsDir(e.Name) {
				a.arm()
			}
			if c, x := core.Roots(a.getSettings()); !refreshNeeded(e, a.config, c, x) {
				continue
			}
			if timer == nil {
				timer = time.NewTimer(300 * time.Millisecond)
				tick = timer.C
			} else {
				timer.Reset(300 * time.Millisecond)
			}
		case <-tick:
			a.refreshFiles()
		}
	}
}

// refreshNeeded reports whether a filesystem event could change what ATC shows. Only
// <claude root>/<project>/<session>.jsonl is a Claude session: subagent transcripts
// write constantly and must not trigger rescans. Structural changes on the way to a root
// matter because a missing root may just have been created.
func refreshNeeded(e fsnotify.Event, config, claude, codex string) bool {
	p := core.PathKey(e.Name)
	under := func(root string) (string, bool) {
		r := core.PathKey(root)
		if p == r {
			return "", true
		}
		return strings.CutPrefix(p, r+`\`)
	}
	onPathTo := func(root string) bool { r := core.PathKey(root); return r == p || strings.HasPrefix(r, p+`\`) }
	structural := e.Has(fsnotify.Create) || e.Has(fsnotify.Remove) || e.Has(fsnotify.Rename)
	if rest, ok := under(config); ok && (rest == "settings.json" || rest == "notes.md") {
		return true
	}
	if rest, ok := under(claude); ok && rest != "" {
		parts := strings.Split(rest, `\`)
		if len(parts) == 2 && filepath.Ext(rest) == ".jsonl" || structural && len(parts) == 1 && filepath.Ext(rest) == "" {
			return true
		}
	}
	if structural && (onPathTo(claude) || onPathTo(codex)) {
		return true
	}
	rest, ok := under(codex)
	return ok && (rest == "session_index.jsonl" || rest == "sessions" || strings.HasPrefix(rest, `sessions\`))
}
func (a *App) refreshFiles() {
	a.diskMu.Lock()
	if s, e := core.LoadSettings(filepath.Join(a.config, "settings.json")); e == nil {
		a.mu.Lock()
		text := jsonText(s)
		changed := text != a.lastSettings
		if changed {
			a.settings = s
			a.lastSettings = text
		}
		a.mu.Unlock()
		if changed {
			a.emit("settings://updated", s)
			a.arm()
		}
	}
	if b, e := os.ReadFile(filepath.Join(a.config, "notes.md")); e == nil {
		a.mu.Lock()
		changed := string(b) != a.notes
		a.notes = string(b)
		a.mu.Unlock()
		if changed {
			a.emit("notes://updated", string(b))
		}
	}
	a.diskMu.Unlock()
	snap := a.index.Scan(a.getSettings(), false)
	text := core.ProjectionKey(snap)
	a.mu.Lock()
	changed := a.lastIndex != text
	a.lastIndex = text
	a.mu.Unlock()
	if changed {
		a.emit("index://updated", snap)
	}
}
func (a *App) session(id string) (*pty.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.ptys[id]
	if p == nil {
		return nil, fmt.Errorf("no such pty: %s", id)
	}
	return p, nil
}

// Invoke is the single reviewed desktop command boundary used by the typed frontend.
// The frontend's command surface. Wails binds every exported method on App and generates
// typed TypeScript for it in wailsjs/go/main, so a wrong name or argument fails the build.

// FrontendReady kills the shells and agent sessions of a page that was replaced by a full
// reload.
func (a *App) FrontendReady(pageID string) {
	a.mu.Lock()
	old := []*pty.Session{}
	replaced := a.pageID != pageID
	if replaced {
		for _, p := range a.ptys {
			old = append(old, p)
		}
		a.ptys = map[string]*pty.Session{}
		a.pageID = pageID
	}
	a.mu.Unlock()
	if replaced {
		a.agents.stop()
	}
	for _, p := range old {
		p.Kill()
		select {
		case <-p.Done():
		case <-time.After(2 * time.Second):
		}
	}
}

func (a *App) SettingsGet() core.Object { return a.getSettings() }

func (a *App) SettingsSet(settings any) error {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	s := a.getSettings()
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	next, err := core.ParseSettings(data)
	if err != nil {
		return err
	}
	if e := core.Save(filepath.Join(a.config, "settings.json"), next); e != nil {
		return e
	}
	a.mu.Lock()
	a.settings = next
	a.lastSettings = jsonText(next)
	a.mu.Unlock()
	if core.ProjectionChanged(s, next, a.config) {
		a.arm()
		a.emit("index://updated", a.index.Scan(next, false))
	}
	return nil
}

func (a *App) NotesGet() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.notes
}

func (a *App) NotesSet(text string) error {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	if e := core.WriteFile(filepath.Join(a.config, "notes.md"), []byte(text)); e != nil {
		return e
	}
	a.mu.Lock()
	a.notes = text
	a.mu.Unlock()
	return nil
}

// IndexScan returns the sidebar's projects and sessions; force rereads every transcript.
func (a *App) IndexScan(force bool) any { return a.index.Scan(a.getSettings(), force) }

func (a *App) UsageCosts() []any { return a.costs.Rows(a.getSettings(), a.config) }

func (a *App) UsageContext() core.Object { return a.costs.Context(a.getSettings(), a.config) }

func (a *App) NewerRelease() any { return newerRelease(appVersion) }

func (a *App) AgentCommand(provider, sessionID string, chat bool) (string, error) {
	if provider != "claude" && provider != "codex" {
		return "", fmt.Errorf("unknown provider: %s", provider)
	}
	return core.AgentCommand(a.getSettings(), provider, sessionID, chat), nil
}

// PtySpawn starts a shell and streams its output as events on channel.
func (a *App) PtySpawn(opts pty.Options, channel string) (string, error) {
	if channel == "" {
		return "", fmt.Errorf("missing PTY event channel")
	}
	id := pty.ID()
	p, e := pty.Spawn(opts, func(event pty.Event) { a.emit(channel, event) })
	if e != nil {
		return "", e
	}
	a.mu.Lock()
	a.ptys[id] = p
	a.mu.Unlock()
	return id, nil
}

func (a *App) PtyWrite(id, data string) error {
	p, e := a.session(id)
	if e != nil {
		return e
	}
	return p.Write(data)
}

func (a *App) PtyResize(id string, cols, rows int) error {
	p, e := a.session(id)
	if e != nil {
		return e
	}
	return p.Resize(cols, rows)
}

func (a *App) PtyAck(id string, bytes int64) error {
	p, e := a.session(id)
	if e != nil {
		return e
	}
	p.Ack(uint64(max(0, bytes)))
	return nil
}

func (a *App) PtyKill(id string) error {
	p, e := a.session(id)
	if e != nil {
		return e
	}
	p.Kill()
	a.mu.Lock()
	delete(a.ptys, id)
	a.mu.Unlock()
	return nil
}

// PtyBusy names what is still running in the shell, or is null.
func (a *App) PtyBusy(id string) (any, error) {
	p, e := a.session(id)
	if e != nil {
		return nil, e
	}
	return p.Busy(), nil
}

func (a *App) PtyStats(id string) (pty.Stats, error) {
	p, e := a.session(id)
	if e != nil {
		return pty.Stats{}, e
	}
	return p.Stats(), nil
}

func (a *App) ScratchDir() (string, error) {
	dir := core.Scratch(a.getSettings(), a.config)
	return dir, os.MkdirAll(dir, 0700)
}

func (a *App) ListThemes() []any {
	out := []any{}
	files, _ := os.ReadDir(filepath.Join(a.config, "themes"))
	for _, f := range files {
		if f.IsDir() || !strings.EqualFold(filepath.Ext(f.Name()), ".json") {
			continue
		}
		b, e := os.ReadFile(filepath.Join(a.config, "themes", f.Name()))
		var palette any
		if e == nil && json.Unmarshal(b, &palette) == nil {
			out = append(out, core.Object{"stem": strings.TrimSuffix(f.Name(), filepath.Ext(f.Name())), "palette": palette})
		}
	}
	return out
}

func (a *App) OpenSettingsFile() error {
	path := filepath.Join(a.config, "settings.json")
	if _, e := os.Stat(path); os.IsNotExist(e) {
		if e = core.Save(path, a.getSettings()); e != nil {
			return e
		}
	}
	return openTarget(path)
}

func (a *App) OpenInExplorer(path string) error {
	// ShellExecute "open" on a file runs it; folders are all the sidebar opens.
	if st, e := os.Stat(path); e != nil {
		return e
	} else if !st.IsDir() {
		return fmt.Errorf("not a folder: %s", path)
	}
	return openTarget(path)
}

func (a *App) OpenURL(url string) error {
	if !validURL(url) {
		return fmt.Errorf("not a web link: %s", url)
	}
	return openTarget(url)
}

func (a *App) WriteTextFile(path, contents string) error {
	return os.WriteFile(path, []byte(contents), 0600)
}

type FileFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// SaveDialog returns the chosen path, or null when cancelled.
func (a *App) SaveDialog(defaultPath string, filters []FileFilter) (any, error) {
	wf := []wr.FileFilter{}
	for _, f := range filters {
		patterns := []string{}
		for _, ext := range f.Extensions {
			patterns = append(patterns, "*."+ext)
		}
		wf = append(wf, wr.FileFilter{DisplayName: f.Name, Pattern: strings.Join(patterns, ";")})
	}
	path, e := wr.SaveFileDialog(a.ctx, wr.SaveDialogOptions{DefaultFilename: defaultPath, Filters: wf})
	return core.Nullable(path), e
}

// FolderDialog returns the chosen folder, or null when cancelled.
func (a *App) FolderDialog() (any, error) {
	path, e := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{Title: "Open a folder"})
	return core.Nullable(path), e
}

func (a *App) NotificationPermission() (bool, error) { return wr.CheckNotificationAuthorization(a.ctx) }

func (a *App) NotificationRequest() (bool, error) { return wr.RequestNotificationAuthorization(a.ctx) }

func (a *App) NotificationSend(title, body string) error {
	return wr.SendNotification(a.ctx, wr.NotificationOptions{Title: title, Body: body})
}

// GitChanges is what `git diff HEAD` and untracked files say changed in dir, or null when
// dir is not a git working tree.
func (a *App) GitChanges(dir string) (any, error) {
	git := func(args ...string) (string, error) {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		// No console at all: a hidden one fails to start (0xc0000142) under some parents.
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
		var stderr strings.Builder
		cmd.Stderr = &stderr
		out, e := cmd.Output()
		if e != nil {
			e = fmt.Errorf("git %s: %w: %s", args[0], e, strings.TrimSpace(stderr.String()))
		}
		return string(out), e
	}
	inside, e := git("rev-parse", "--is-inside-work-tree")
	if e != nil && strings.Contains(e.Error(), "not a git repository") || e == nil && strings.TrimSpace(inside) != "true" {
		return nil, nil
	} else if e != nil {
		return nil, e
	}
	stat, e := git("diff", "--shortstat", "HEAD")
	if e != nil {
		return nil, e
	}
	untracked, e := git("ls-files", "--others", "--exclude-standard")
	if e != nil {
		return nil, e
	}
	lines := strings.FieldsFunc(untracked, func(r rune) bool { return r == '\n' || r == '\r' })
	out := core.Object{"files": int64(0), "insertions": int64(0), "deletions": int64(0), "untracked": int64(len(lines))}
	for _, m := range regexp.MustCompile(`(\d+) (file|insertion|deletion)`).FindAllStringSubmatch(stat, -1) {
		n, _ := strconv.ParseInt(m[1], 10, 64)
		out[map[string]string{"file": "files", "insertion": "insertions", "deletion": "deletions"}[m[2]]] = n
	}
	return out, nil
}

func (a *App) ClaudeUsage() (any, error) {
	v, e := claudeUsage()
	if e == nil {
		a.history.record(a.config, "claude", v)
	}
	return v, e
}

func (a *App) CodexUsage() (any, error) {
	v, e := a.limits.read(a.getSettings())
	if e == nil && v != nil {
		a.history.record(a.config, "codex", v)
	}
	return v, e
}

// LimitsHistory is every plan-limit reading of the last 8 days, oldest first, for the
// usage page's fill graph and forecast (#27, #161).
func (a *App) LimitsHistory() ([]core.Object, error) { return a.history.read(a.config) }

func (a *App) CodexUsageStop() { a.limits.stop() }

// newerRelease is the latest GitHub release when it is newer than the running build, else
// nil. Offline or rate-limited simply means no notice.
func newerRelease(current string) any {
	c := http.Client{Timeout: 15 * time.Second}
	res, e := c.Get("https://api.github.com/repos/arghya2801/agent-terminal-control/releases/latest")
	if e != nil {
		return nil
	}
	defer res.Body.Close()
	var r struct {
		Tag string `json:"tag_name"`
		URL string `json:"html_url"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(&r) != nil || !newer(strings.TrimPrefix(r.Tag, "v"), current) || !validURL(r.URL) {
		return nil
	}
	return core.Object{"version": strings.TrimPrefix(r.Tag, "v"), "url": r.URL}
}

// newer compares dotted versions number by number; a missing part counts as 0.
func newer(a, b string) bool {
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < max(len(x), len(y)); i++ {
		var m, n int
		if i < len(x) {
			m, _ = strconv.Atoi(x[i])
		}
		if i < len(y) {
			n, _ = strconv.Atoi(y[i])
		}
		if m != n {
			return m > n
		}
	}
	return false
}

func validURL(url string) bool {
	lower := strings.ToLower(url)
	if !(strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")) || len(url) <= 8 {
		return false
	}
	for _, r := range url {
		if r <= ' ' || r == '"' {
			return false
		}
	}
	return true
}
func openTarget(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	path, e := windows.UTF16PtrFromString(target)
	if e != nil {
		return e
	}
	return windows.ShellExecute(0, verb, path, nil, nil, windows.SW_SHOWNORMAL)
}
