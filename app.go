package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unicode/utf8"

	"atc/internal/core"
	"atc/internal/pty"
	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

type App struct {
	pageID       string
	diskMu       sync.Mutex
	watchMu      sync.Mutex
	claudeRoot   string // claudeRoot and codexRoot are set by arm, under watchMu
	codexRoot    string
	ctx          context.Context
	wapp         *application.App
	win          *application.WebviewWindow
	notifier     *notifications.NotificationService
	config       string
	mu           sync.Mutex
	settings     core.Object
	notes        string
	userCSS      string
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
	searches     atomic.Uint64 // the latest transcript search; older ones stop scanning
	open         string        // the folder from --open, until the page takes it
}

// TakeOpen returns the folder ATC was started with `--open`, once (#278).
func (a *App) TakeOpen() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	dir := a.open
	a.open = ""
	return dir
}

// secondLaunch runs when ATC starts while this copy runs: this one comes forward and opens
// the folder the other was given, which then exits.
func (a *App) secondLaunch(d application.SecondInstanceData) {
	a.bringForward()
	if dir := openArg(d.Args); dir != "" {
		a.emit("open://dir", dir)
	}
}

// openArg is the folder after `--open`, made absolute: a second launch hands its arguments
// to the first copy, which runs in another directory.
func openArg(args []string) string {
	for i, arg := range args {
		dir, ok := strings.CutPrefix(arg, "--open=")
		if !ok && arg == "--open" && i+1 < len(args) {
			dir, ok = args[i+1], true
		}
		if ok && dir != "" {
			if abs, err := filepath.Abs(dir); err == nil {
				return abs
			}
			return dir
		}
	}
	return ""
}

func NewApp(config string) *App {
	return &App{config: config, ptys: map[string]*pty.Session{}, index: core.Index{CachePath: filepath.Join(config, "index-go.json")}}
}

// bringForward shows the window without changing its size: a maximised window stays
// maximised (#281).
func (a *App) bringForward() {
	if a.win == nil {
		return
	}
	if a.win.IsMinimised() {
		a.win.Restore()
	}
	a.win.Show()
	a.win.Focus()
}

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.startup(ctx)
	return nil
}
func (a *App) ServiceShutdown() error {
	a.shutdown()
	return nil
}
func (a *App) startup(ctx context.Context) {
	a.ctx, a.cancel = context.WithCancel(ctx)
	a.load()
	_ = os.MkdirAll(a.config, 0700)
	go core.RefreshPrices(a.config)
	if on, _ := core.Obj(a.getSettings()["prices"])["litellm"].(bool); on {
		go core.RefreshLitellm(a.config)
	}
	a.watcher, _ = fsnotify.NewWatcher()
	if a.watcher != nil {
		a.arm()
		go a.watch()
	}
}
func (a *App) shutdown() {
	a.cancel()
	if a.watcher != nil {
		a.watcher.Close()
	}
	a.limits.stop()
	a.agents.stop()
	a.killAll()
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
	killWait(sessions)
}
func killWait(sessions []*pty.Session) {
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
	if a.wapp != nil {
		a.wapp.Event.Emit(name, value)
	}
}
func (a *App) arm() {
	if a.watcher == nil {
		return
	}
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	c, x := core.Roots(a.getSettings())
	a.claudeRoot, a.codexRoot = c, x
	desired := map[string]bool{}
	// Claude sessions are <root>/<project>/<session>.jsonl, so watching one level down is enough.
	for _, target := range []struct {
		path      string
		recursive bool
		shallow   bool
	}{{a.config, false, false}, {c, true, true}, {x, false, false}, {filepath.Join(x, "sessions"), true, false}} {
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
					if target.shallow && p != root {
						return filepath.SkipDir
					}
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
			a.watchMu.Lock()
			c, x := a.claudeRoot, a.codexRoot
			a.watchMu.Unlock()
			if e.Has(fsnotify.Create) && core.IsDir(e.Name) {
				if rest, ok := strings.CutPrefix(core.PathKey(e.Name), core.PathKey(c)+`\`); !ok || !strings.Contains(rest, `\`) {
					a.arm()
				}
			}
			if !refreshNeeded(e, a.config, c, x) {
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
	if rest, ok := under(config); ok && (rest == "settings.json" || rest == "notes.md" || rest == "user.css") {
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
	css := a.UserCSS()
	a.mu.Lock()
	cssChanged := css != a.userCSS
	a.userCSS = css
	a.mu.Unlock()
	if cssChanged {
		a.emit("usercss://updated", css)
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

// The frontend's command surface. Wails binds every exported method on App and generates
// typed TypeScript for it in src/bindings, so a wrong name or argument fails the build.

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
	killWait(old)
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

// UserCSS is the user's own stylesheet, user.css in the config folder, applied after the app's.
func (a *App) UserCSS() string {
	b, _ := os.ReadFile(filepath.Join(a.config, "user.css"))
	return string(b)
}

// SaveTheme writes a theme to the themes folder under a name made safe for a file name.
func (a *App) SaveTheme(name string, theme core.Object) (string, error) {
	stem := strings.Trim(regexp.MustCompile(`[^\w -]+`).ReplaceAllString(name, ""), " .")
	if stem == "" {
		return "", fmt.Errorf("a theme needs a name")
	}
	theme["name"] = name
	return stem, core.Save(filepath.Join(a.config, "themes", stem+".json"), theme)
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
func (a *App) ModelInputPrices(models []string) core.Object {
	return core.InputPrices(a.getSettings(), a.config, models)
}

func (a *App) Version() string { return appVersion }

func (a *App) NewerRelease() any { return newerRelease(appVersion) }

func (a *App) Shells() []string { return pty.Shells() }

var logMu sync.Mutex

// AppendLog adds one timestamped line to atc.log in the config folder, dropping lines
// more than two days old.
func (a *App) AppendLog(line string) error {
	const layout = "2006-01-02 15:04:05.000"
	logMu.Lock()
	defer logMu.Unlock()
	path, now := filepath.Join(a.config, "atc.log"), time.Now()
	old, _ := os.ReadFile(path)
	keep := []string{}
	for l := range strings.SplitSeq(string(old), "\n") {
		if t, e := time.ParseInLocation(layout, l[:min(len(l), len(layout))], time.Local); e == nil && now.Sub(t) < 48*time.Hour {
			keep = append(keep, l)
		}
	}
	keep = append(keep, now.Format(layout)+" "+strings.ReplaceAll(line, "\n", " "))
	return core.WriteFile(path, []byte(strings.Join(keep, "\n")+"\n"))
}

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
	opts.Env = a.accountEnv(opts.Account)
	id := pty.ID()
	a.mu.Lock()
	page := a.pageID
	a.mu.Unlock()
	p, e := pty.Spawn(opts, func(event pty.Event) { a.emit(channel, event) })
	if e != nil {
		return "", e
	}
	a.mu.Lock()
	stale := a.pageID != page
	if !stale {
		a.ptys[id] = p
	}
	a.mu.Unlock()
	if stale {
		p.Kill()
		return "", fmt.Errorf("page reloaded during spawn")
	}
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

// OpenPath opens a file or folder from a link with its default app, if it exists.
func (a *App) OpenPath(path string) error {
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return fmt.Errorf("not a local absolute path: %s", path)
	}
	if st, e := os.Stat(path); e != nil {
		return e
	} else if !st.IsDir() && strings.Contains(";.exe;.com;.bat;.cmd;.msi;.ps1;.vbs;.vbe;.js;.jse;.wsf;.hta;.scr;.lnk;.cpl;.reg;.jar;", ";"+strings.ToLower(filepath.Ext(path))+";") {
		return fmt.Errorf("will not run a program from a link: %s", path)
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

const maxTextFile = 2 << 20

func editableFile(path string) error {
	if !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return fmt.Errorf("not a local absolute path: %s", path)
	}
	st, e := os.Lstat(path)
	if e != nil {
		return e
	}
	return checkTextFile(st, path)
}

func checkTextFile(st os.FileInfo, path string) error {
	if !st.Mode().IsRegular() {
		return fmt.Errorf("not a file: %s", path)
	}
	if st.Size() > maxTextFile {
		return fmt.Errorf("file is over 2 MB: %s", path)
	}
	return nil
}

func (a *App) ReadTextFile(path string) (string, error) {
	if e := editableFile(path); e != nil {
		return "", e
	}
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return "", e
	}
	if e = checkTextFile(st, path); e != nil {
		return "", e
	}
	b, e := io.ReadAll(io.LimitReader(f, maxTextFile+1))
	if e != nil {
		return "", e
	}
	if len(b) > maxTextFile || !utf8.Valid(b) {
		return "", fmt.Errorf("not a UTF-8 text file under 2 MB: %s", path)
	}
	return string(b), nil
}

func (a *App) WriteTextFile(path, contents string) error {
	if e := editableFile(path); e != nil {
		return e
	}
	if len(contents) > maxTextFile || !utf8.ValidString(contents) {
		return fmt.Errorf("contents are not UTF-8 text under 2 MB")
	}
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	if e != nil {
		return e
	}
	_, e = f.WriteString(contents)
	if c := f.Close(); e == nil {
		e = c
	}
	return e
}

type ConfigFile struct {
	Label  string `json:"label"`
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
	Global bool   `json:"global"`
}

func (a *App) ConfigFiles(project string) []ConfigFile {
	claude := os.Getenv("CLAUDE_CONFIG_DIR")
	if claude == "" {
		claude = filepath.Join(core.Home(), ".claude")
	}
	_, codex := core.Roots(a.getSettings())
	var out []ConfigFile
	add := func(label, path string, global bool) {
		_, e := os.Stat(path)
		if global || e == nil {
			out = append(out, ConfigFile{label, path, e == nil, global})
		}
	}
	add("Claude settings", filepath.Join(claude, "settings.json"), true)
	add("Claude instructions", filepath.Join(claude, "CLAUDE.md"), true)
	add("Codex config", filepath.Join(codex, "config.toml"), true)
	add("Codex instructions", filepath.Join(codex, "AGENTS.md"), true)
	add("ATC styles", filepath.Join(a.config, "user.css"), true)
	if filepath.IsAbs(project) {
		add("Project settings", filepath.Join(project, ".claude", "settings.json"), false)
		add("Project local settings", filepath.Join(project, ".claude", "settings.local.json"), false)
		add("Project instructions", filepath.Join(project, "CLAUDE.md"), false)
	}
	return out
}

func (a *App) CreateConfigFile(path string) error {
	for _, c := range a.ConfigFiles("") {
		if c.Path == path {
			if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
				return e
			}
			f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e != nil {
				return e
			}
			return f.Close()
		}
	}
	return fmt.Errorf("not a config file: %s", path)
}

func (a *App) OpenURL(url string) error {
	if !validURL(url) {
		return fmt.Errorf("not a web link: %s", url)
	}
	return openTarget(url)
}

type FileFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// SaveTextFile asks where to save contents and writes them there, returning the path, or
// null when cancelled. The page never names the path, so it can't write anywhere else (#230).
func (a *App) SaveTextFile(defaultPath string, filters []FileFilter, contents string) (any, error) {
	wf := []application.FileFilter{}
	for _, f := range filters {
		patterns := []string{}
		for _, ext := range f.Extensions {
			patterns = append(patterns, "*."+ext)
		}
		wf = append(wf, application.FileFilter{DisplayName: f.Name, Pattern: strings.Join(patterns, ";")})
	}
	path, e := a.wapp.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{Filename: defaultPath, Filters: wf}).PromptForSingleSelection()
	if e != nil || path == "" {
		return nil, e
	}
	return path, os.WriteFile(path, []byte(contents), 0600)
}

// FolderDialog returns the chosen folder, or null when cancelled.
func (a *App) FolderDialog() (any, error) {
	path, e := a.wapp.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{Title: "Open a folder", CanChooseDirectories: true}).PromptForSingleSelection()
	return core.Nullable(path), e
}

func (a *App) NotificationPermission() (bool, error) {
	return a.notifier.CheckNotificationAuthorization()
}

func (a *App) NotificationRequest() (bool, error) {
	return a.notifier.RequestNotificationAuthorization()
}

// NotificationSend shows a Windows notification; id comes back on a click, as the tab to open.
func (a *App) NotificationSend(title, body, id string) error {
	return a.notifier.SendNotification(notifications.NotificationOptions{ID: id, Title: title, Body: body})
}

// SetWindowTheme matches the title bar and backdrop to a light or dark palette. Wails v3 has
// no runtime theme switch, so this goes to the window directly.
func (a *App) SetWindowTheme(light bool) {
	if a.win != nil {
		if h := a.win.NativeWindow(); h != nil {
			w32.SetTheme(uintptr(h), !light)
		}
	}
}

// GitChanges is what `git diff HEAD` and untracked files say changed in dir, or null when
// dir is not a git working tree.
func (a *App) GitChanges(dir string) (any, error) {
	git := func(args ...string) (string, error) {
		// A repo's own fsmonitor would run a command it names.
		cmd := exec.Command("git", append([]string{"-c", "core.fsmonitor=false", "-C", dir}, args...)...)
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

// ClaudeUsage is the default account's plan limits. Only the ~/.claude login's go in the
// history, so another account's readings never mix into its fill graph.
func (a *App) ClaudeUsage() (any, error) {
	acc, ok := a.account(a.defaultAccount())
	if ok {
		return claudeUsage(&acc)
	}
	v, e := claudeUsage(nil)
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
	r, e := latestRelease()
	if e != nil || !newer(strings.TrimPrefix(r.Tag, "v"), current) || !validURL(r.URL) {
		return nil
	}
	exe, _ := os.Executable()
	return core.Object{"version": strings.TrimPrefix(r.Tag, "v"), "url": r.URL, "installable": installKind(exe) != ""}
}

// newer compares dotted versions number by number; a missing part counts as 0. A
// prerelease (`0.7.3-beta`) comes before the release of the same number.
func newer(a, b string) bool {
	a, preA, _ := strings.Cut(a, "-")
	b, preB, _ := strings.Cut(b, "-")
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
	return preA == "" && preB != ""
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
