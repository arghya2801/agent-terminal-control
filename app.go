package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"atc/internal/core"
	"atc/internal/pty"
	"github.com/fsnotify/fsnotify"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type App struct {
	pageID                  string
	diskMu                  sync.Mutex
	watchMu                 sync.Mutex
	ctx                     context.Context
	config                  string
	mu                      sync.Mutex
	settings                core.Object
	notes                   string
	ptys                   map[string]*pty.Session
	index                   core.Index
	costs                   core.Costs
	limits                  limitsClient
	watcher                 *fsnotify.Watcher
	cancel                  context.CancelFunc
	lastIndex               string
	lastSettings            string
}

func NewApp(config string) *App {
	return &App{config: config, ptys: map[string]*pty.Session{}, index: core.Index{CachePath: filepath.Join(config, "index-go.json")}}
}
func (a *App) startup(ctx context.Context) {
	a.ctx, a.cancel = context.WithCancel(ctx)
	a.load()
	_ = os.MkdirAll(a.config, 0700)
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
func (a *App) Invoke(command string, args core.Object) (any, error) {
	s := a.getSettings()
	str := func(k string) string { return core.Str(args[k]) }
	switch command {
	case "frontend_ready":
		a.mu.Lock()
		old := []*pty.Session{}
		if a.pageID != str("pageID") {
			for _, p := range a.ptys {
				old = append(old, p)
			}
			a.ptys = map[string]*pty.Session{}
			a.pageID = str("pageID")
		}
		a.mu.Unlock()
		for _, p := range old {
			p.Kill()
			select {
			case <-p.Done():
			case <-time.After(2 * time.Second):
			}
		}
		return nil, nil
	case "settings_get":
		return s, nil
	case "settings_set":
		a.diskMu.Lock()
		defer a.diskMu.Unlock()
		data, err := json.Marshal(args["settings"])
		if err != nil {
			return nil, err
		}
		next, err := core.ParseSettings(data)
		if err != nil {
			return nil, err
		}
		if e := core.Save(filepath.Join(a.config, "settings.json"), next); e != nil {
			return nil, e
		}
		a.mu.Lock()
		a.settings = next
		a.lastSettings = jsonText(next)
		a.mu.Unlock()
		if core.ProjectionChanged(s, next, a.config) {
			a.arm()
			a.emit("index://updated", a.index.Scan(next, false))
		}
		return nil, nil
	case "notes_get":
		a.mu.Lock()
		defer a.mu.Unlock()
		return a.notes, nil
	case "notes_set":
		a.diskMu.Lock()
		defer a.diskMu.Unlock()
		text, ok := args["text"].(string)
		if !ok {
			return nil, fmt.Errorf("notes must be text")
		}
		if e := core.WriteFile(filepath.Join(a.config, "notes.md"), []byte(text)); e != nil {
			return nil, e
		}
		a.mu.Lock()
		a.notes = text
		a.mu.Unlock()
		return nil, nil
	case "index_snapshot", "index_refresh":
		return a.index.Scan(s, core.Bool(args["force"])), nil
	case "usage_costs":
		return a.costs.Rows(s, a.config), nil
	case "agent_command":
		provider := str("provider")
		if provider != "claude" && provider != "codex" {
			return nil, fmt.Errorf("unknown provider: %s", provider)
		}
		return core.AgentCommand(s, provider, str("sessionId")), nil
	case "pty_spawn":
		var opts pty.Options
		b, _ := json.Marshal(args["opts"])
		if e := json.Unmarshal(b, &opts); e != nil {
			return nil, e
		}
		channel := str("channel")
		if channel == "" {
			return nil, fmt.Errorf("missing PTY event channel")
		}
		id := pty.ID()
		p, e := pty.Spawn(opts, func(event pty.Event) { a.emit(channel, event) })
		if e != nil {
			return nil, e
		}
		a.mu.Lock()
		a.ptys[id] = p
		a.mu.Unlock()
		return id, nil
	case "pty_write", "pty_resize", "pty_ack", "pty_kill", "pty_busy", "pty_stats":
		p, e := a.session(str("id"))
		if e != nil {
			return nil, e
		}
		switch command {
		case "pty_write":
			return nil, p.Write(str("data"))
		case "pty_resize":
			return nil, p.Resize(int(core.Num(args["cols"])), int(core.Num(args["rows"])))
		case "pty_ack":
			p.Ack(uint64(max(0, core.Num(args["bytes"]))))
		case "pty_kill":
			p.Kill()
			a.mu.Lock()
			delete(a.ptys, str("id"))
			a.mu.Unlock()
		case "pty_busy":
			return p.Busy(), nil
		case "pty_stats":
			return p.Stats(), nil
		}
		return nil, nil
	case "scratch_dir":
		dir := core.Scratch(s, a.config)
		if str("kind") == "chats" {
			dir = core.Chats(a.config)
		}
		return dir, os.MkdirAll(dir, 0700)
	case "list_themes":
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
		return out, nil
	case "open_settings_file":
		path := filepath.Join(a.config, "settings.json")
		if _, e := os.Stat(path); os.IsNotExist(e) {
			if e = core.Save(path, s); e != nil {
				return nil, e
			}
		}
		return nil, openTarget(path)
	case "open_in_explorer":
		path := str("path")
		if _, e := os.Stat(path); e != nil {
			return nil, e
		}
		return nil, openTarget(path)
	case "open_url":
		url := str("url")
		if !validURL(url) {
			return nil, fmt.Errorf("not a web link: %s", url)
		}
		return nil, openTarget(url)
	case "write_text_file":
		return nil, os.WriteFile(str("path"), []byte(str("contents")), 0600)
	case "save_dialog":
		opts := core.Obj(args["options"])
		filters := []wr.FileFilter{}
		for _, v := range core.Arr(opts["filters"]) {
			f := core.Obj(v)
			patterns := []string{}
			for _, ext := range core.Arr(f["extensions"]) {
				patterns = append(patterns, "*."+core.Str(ext))
			}
			filters = append(filters, wr.FileFilter{DisplayName: core.Str(f["name"]), Pattern: strings.Join(patterns, ";")})
		}
		path, e := wr.SaveFileDialog(a.ctx, wr.SaveDialogOptions{DefaultFilename: core.Str(opts["defaultPath"]), Filters: filters})
		return core.Nullable(path), e
	case "notification_permission":
		return wr.CheckNotificationAuthorization(a.ctx)
	case "notification_request":
		return wr.RequestNotificationAuthorization(a.ctx)
	case "notification_send":
		o := core.Obj(args["options"])
		return nil, wr.SendNotification(a.ctx, wr.NotificationOptions{Title: core.Str(o["title"]), Body: core.Str(o["body"])})
	case "claude_usage":
		return claudeUsage()
	case "codex_usage":
		return a.limits.read(s)
	case "codex_usage_stop":
		a.limits.stop()
		return nil, nil
	case "open_devtools":
		// Wails handles Ctrl+Shift+F12 natively in debug builds.
		return nil, nil
	default:
		return nil, fmt.Errorf("unknown command: %s", command)
	}
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
