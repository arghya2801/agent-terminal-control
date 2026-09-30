package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"atc/internal/core"
	"github.com/fsnotify/fsnotify"
)

// Ported from src-tauri: index/watcher.rs, settings/watcher.rs, settings/tasks.rs,
// commands.rs, pty/registry.rs and codex_limits.rs.

const claudeRoot = `C:\Users\x\.claude\projects`
const codexRoot = `C:\Users\x\.codex`
const configRoot = `C:\Users\x\AppData\Roaming\Agent Terminal Control`

func needed(path string, op fsnotify.Op) bool {
	return refreshNeeded(fsnotify.Event{Name: path, Op: op}, configRoot, claudeRoot, codexRoot)
}

func TestASessionTranscriptIsRelevant(t *testing.T) {
	if !needed(claudeRoot+`\D--Coding-p\abc.jsonl`, fsnotify.Write) {
		t.Fatal("a session write was ignored")
	}
}
func TestSubagentTranscriptsAreIgnored(t *testing.T) {
	// These would otherwise fire constantly and inflate the session list.
	if needed(claudeRoot+`\D--Coding-p\abc\subagents\agent-1.jsonl`, fsnotify.Write) {
		t.Fatal("a subagent write triggered a rescan")
	}
}
func TestNonJsonlFilesAreIgnored(t *testing.T) {
	if needed(claudeRoot+`\D--Coding-p\abc.meta.json`, fsnotify.Write) || needed(claudeRoot+`\D--Coding-p`, fsnotify.Write) {
		t.Fatal("a non-transcript change triggered a rescan")
	}
}
func TestATranscriptDirectlyInTheRootIsIgnored(t *testing.T) {
	// Sessions always live one level down, inside a project directory.
	if needed(claudeRoot+`\stray.jsonl`, fsnotify.Write) {
		t.Fatal("a stray root transcript triggered a rescan")
	}
}
func TestPathsOutsideTheRootsAreIgnored(t *testing.T) {
	if needed(`D:\elsewhere\a\b.jsonl`, fsnotify.Write) || needed(`D:\elsewhere\settings.json`, fsnotify.Write) {
		t.Fatal("an unrelated path triggered a rescan")
	}
}
func TestStructuralChangesOnTheWayToARootAreRelevant(t *testing.T) {
	// A missing root may just have been created; a new project directory appears.
	for _, p := range []string{`C:\Users\x\.claude`, codexRoot, claudeRoot + `\D--Coding-new`} {
		if !needed(p, fsnotify.Create) {
			t.Error(p, "creation ignored")
		}
	}
	if needed(claudeRoot+`\D--Coding-new`, fsnotify.Write) {
		t.Error("a plain write to a project directory triggered a rescan")
	}
}
func TestCodexIndexAndSessionsAreRelevant(t *testing.T) {
	for _, p := range []string{codexRoot + `\session_index.jsonl`, codexRoot + `\sessions\2026\09\20\rollout.jsonl`} {
		if !needed(p, fsnotify.Write) {
			t.Error(p)
		}
	}
	if needed(codexRoot+`\config.toml`, fsnotify.Write) {
		t.Error("Codex config triggered a rescan")
	}
}
func TestOnlyTheSettingsAndNotesFilesInTheConfigDirAreRelevant(t *testing.T) {
	if !needed(configRoot+`\settings.json`, fsnotify.Write) || !needed(configRoot+`\NOTES.MD`, fsnotify.Rename) {
		t.Fatal("a settings or notes save was ignored")
	}
	if needed(configRoot+`\index-go.json`, fsnotify.Write) || needed(configRoot+`\tasks.json`, fsnotify.Create) {
		t.Fatal("an unrelated file in the config directory triggered a rescan")
	}
}

// The real fsnotify plumbing: arm() must watch the right directories so these events
// arrive at all, including for roots that do not exist yet.
func watchedApp(t *testing.T) (*App, string, string) {
	t.Helper()
	dir := t.TempDir()
	claude, codex := filepath.Join(dir, "claude", "projects"), filepath.Join(dir, "codex")
	a := NewApp(filepath.Join(dir, "config"))
	os.MkdirAll(a.config, 0700)
	a.load()
	core.Obj(a.settings["projects"])["claudeProjectsDir"] = claude
	core.Obj(a.settings["codex"])["homeDir"] = codex
	w, e := fsnotify.NewWatcher()
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { w.Close() })
	a.watcher = w
	a.arm()
	return a, claude, codex
}
func awaitRelevant(t *testing.T, a *App, claude, codex string, act func()) {
	t.Helper()
	time.Sleep(100 * time.Millisecond)
	act()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case e := <-a.watcher.Events:
			if e.Has(fsnotify.Create) && core.IsDir(e.Name) {
				a.arm()
			}
			if refreshNeeded(e, a.config, claude, codex) {
				return
			}
		case <-deadline:
			t.Fatal("no relevant event arrived")
		}
	}
}
func TestMissingRootsWatchOnlyTheNearestExistingParent(t *testing.T) {
	a, claude, codex := watchedApp(t)
	want := []string{a.config, filepath.Dir(filepath.Dir(claude))}
	got := a.watcher.WatchList()
	sort.Strings(want)
	sort.Strings(got)
	if !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	awaitRelevant(t, a, claude, codex, func() { os.MkdirAll(codex, 0700) })
	os.MkdirAll(filepath.Join(claude, "D--Coding-p"), 0700)
	awaitRelevant(t, a, claude, codex, func() {})
	awaitRelevant(t, a, claude, codex, func() {
		os.WriteFile(filepath.Join(claude, "D--Coding-p", "new.jsonl"), []byte("{}\n"), 0600)
	})
}
func TestANewTranscriptTriggersARefreshAndASubagentDoesNot(t *testing.T) {
	a, claude, codex := watchedApp(t)
	sub := filepath.Join(claude, "D--Coding-p", "sess", "subagents")
	os.MkdirAll(sub, 0700)
	a.arm()
	time.Sleep(100 * time.Millisecond)
	os.WriteFile(filepath.Join(sub, "agent.jsonl"), []byte("{}\n"), 0600)
	quiet := time.After(1500 * time.Millisecond)
drain:
	for {
		select {
		case e := <-a.watcher.Events:
			if refreshNeeded(e, a.config, claude, codex) && !e.Has(fsnotify.Create) {
				t.Fatal("a subagent write triggered a rescan", e)
			}
		case <-quiet:
			break drain
		}
	}
	awaitRelevant(t, a, claude, codex, func() {
		os.WriteFile(filepath.Join(claude, "D--Coding-p", "new.jsonl"), []byte("{}\n"), 0600)
	})
}
func TestWritingOrReplacingTheSettingsFileFires(t *testing.T) {
	// Editors save by writing a temp file and renaming it over the target.
	a, claude, codex := watchedApp(t)
	path := filepath.Join(a.config, "settings.json")
	awaitRelevant(t, a, claude, codex, func() { os.WriteFile(path, []byte(`{"ui":{"zoom":1.25}}`), 0600) })
	awaitRelevant(t, a, claude, codex, func() {
		tmp := path + ".tmp"
		os.WriteFile(tmp, []byte(`{"ui":{"zoom":2.0}}`), 0600)
		os.Rename(tmp, path)
	})
}

// --- retired tasks

func TestAnExistingTasksFileAlwaysWinsOverLeftoversInSettings(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ATC_CONFIG_DIR", dir)
	core.Save(filepath.Join(dir, "tasks.json"), []any{core.Object{"id": 1, "title": "t1"}})
	core.Save(filepath.Join(dir, "settings.json"), core.Object{"tasks": []any{core.Object{"id": 9, "title": "leftover"}}})
	a := NewApp(dir)
	a.load()
	if a.notes != "- [ ] t1\n" {
		t.Fatalf("%q", a.notes)
	}
}

// --- settings store

func TestTheSettingsStoreSharesUpdates(t *testing.T) {
	a := NewApp(t.TempDir())
	a.load()
	s := a.getSettings()
	core.Obj(s["ui"])["sidebarOpen"] = false
	if _, e := a.Invoke("settings_set", core.Object{"settings": s}); e != nil {
		t.Fatal(e)
	}
	got, _ := a.Invoke("settings_get", nil)
	if core.Obj(core.Obj(got)["ui"])["sidebarOpen"] != false {
		t.Fatal(got)
	}
}
func TestAnExplicitIndexRefreshAlwaysReports(t *testing.T) {
	// Rust invalidated its last-emitted hash here; Go returns the snapshot directly.
	a := NewApp(t.TempDir())
	a.load()
	core.Obj(a.settings["projects"])["claudeProjectsDir"] = filepath.Join(a.config, "claude")
	core.Obj(a.settings["codex"])["homeDir"] = filepath.Join(a.config, "codex")
	for i := 0; i < 2; i++ {
		v, e := a.Invoke("index_refresh", core.Object{"force": false})
		if e != nil || core.Obj(v)["projects"] == nil {
			t.Fatal(v, e)
		}
	}
}

// --- commands.rs

func themes(t *testing.T, files map[string]string) []string {
	t.Helper()
	a := NewApp(t.TempDir())
	a.load()
	if files != nil {
		os.MkdirAll(filepath.Join(a.config, "themes"), 0700)
		for name, body := range files {
			os.WriteFile(filepath.Join(a.config, "themes", name), []byte(body), 0600)
		}
	}
	v, e := a.Invoke("list_themes", nil)
	if e != nil {
		t.Fatal(e)
	}
	stems := []string{}
	for _, th := range core.Arr(v) {
		stems = append(stems, core.Str(core.Obj(th)["stem"]))
	}
	return stems
}
func TestAMissingThemesFolderIsEmptyNotAnError(t *testing.T) {
	if s := themes(t, nil); len(s) != 0 {
		t.Fatal(s)
	}
}
func TestThemesReadJSONFilesOnlyIgnoringCaseAndSkippingMalformedOnes(t *testing.T) {
	s := themes(t, map[string]string{"good.json": "{}", "Shout.JSON": "{}", "bad.json": "{nope", "notes.txt": "{}"})
	sort.Strings(s)
	if !reflect.DeepEqual(s, []string{"Shout", "good"}) {
		t.Fatal(s)
	}
}
func TestTheThemeOrderIsStable(t *testing.T) {
	if s := themes(t, map[string]string{"c.json": "{}", "a.json": "{}", "b.json": "{}"}); !reflect.DeepEqual(s, []string{"a", "b", "c"}) {
		t.Fatal(s)
	}
}
func TestListsLocalBranchesAndIsEmptyOutsideARepo(t *testing.T) {
	if _, e := exec.LookPath("git"); e != nil {
		t.Skip("git is not installed")
	}
	a := NewApp(t.TempDir())
	a.load()
	dir := t.TempDir()
	branches := func(path string) []string {
		v, e := a.Invoke("git_branches", core.Object{"path": path})
		if e != nil {
			t.Fatal(e)
		}
		b := v.([]string)
		sort.Strings(b)
		return b
	}
	if b := branches(dir); len(b) != 0 {
		t.Fatal(b)
	}
	if b := branches(filepath.Join(dir, "missing")); len(b) != 0 {
		t.Fatal(b)
	}
	for _, args := range [][]string{{"init", "-q", "-b", "main"}, {"commit", "-q", "--allow-empty", "-m", "x"}, {"branch", "feat/tasks"}} {
		cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}, args...)...)
		cmd.Dir = dir
		if out, e := cmd.CombinedOutput(); e != nil {
			t.Fatal(args, string(out))
		}
	}
	if b := branches(dir); !reflect.DeepEqual(b, []string{"feat/tasks", "main"}) {
		t.Fatal(b)
	}
}

// --- pty/registry.rs

func TestUnknownTerminalIdsAreReportedNotPanickedOn(t *testing.T) {
	a := NewApp(t.TempDir())
	a.load()
	for _, command := range []string{"pty_write", "pty_resize", "pty_kill", "pty_ack", "pty_busy", "pty_stats"} {
		if _, e := a.Invoke(command, core.Object{"id": "nope", "data": "x", "cols": 10.0, "rows": 10.0}); e == nil {
			t.Error(command, "accepted an unknown id")
		}
	}
}
func TestKillAllOnAnEmptyRegistryIsANoop(t *testing.T) {
	// Runs on every app exit, including exits before any tab was opened.
	NewApp(t.TempDir()).killAll()
}
func TestKillingTerminalsRemovesThemAndKillAllTearsDownEverySession(t *testing.T) {
	t.Setenv("ATC_SHELL_NO_PROFILE", "1")
	a := NewApp(t.TempDir())
	a.load()
	ids := []string{}
	for i := 0; i < 3; i++ {
		v, e := a.Invoke("pty_spawn", core.Object{"channel": "test", "opts": core.Object{"cols": 80, "rows": 24}})
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, core.Str(v))
	}
	if _, e := a.Invoke("pty_resize", core.Object{"id": ids[0], "cols": 100.0, "rows": 30.0}); e != nil {
		t.Fatal("resize did not reach a live session", e)
	}
	a.mu.Lock()
	first := a.ptys[ids[0]]
	a.mu.Unlock()
	if _, e := a.Invoke("pty_kill", core.Object{"id": ids[0]}); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Invoke("pty_write", core.Object{"id": ids[0], "data": "x"}); e == nil {
		t.Fatal("a killed session still accepted input")
	}
	select {
	case <-first.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("kill did not stop the stream")
	}
	a.killAll()
	a.mu.Lock()
	left := len(a.ptys)
	a.mu.Unlock()
	if left != 0 {
		t.Fatal(left, "sessions survived killAll")
	}
}

// --- codex_limits.rs

func TestAMisconfiguredCLIIsAnErrorAndStartsNoProcess(t *testing.T) {
	s := core.Defaults()
	core.Obj(s["codex"])["command"] = "atc-nonexistent-codex-123.exe"
	var client limitsClient
	if _, e := client.read(s); e == nil || e.Error() != "Codex `atc-nonexistent-codex-123.exe` not found" {
		t.Fatal(e)
	}
	if client.child != nil {
		t.Fatal("a process was started")
	}
}
func TestAnUninstalledDefaultCodexIsLeftOutQuietly(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	var client limitsClient
	if v, e := client.read(core.Defaults()); v != nil || e != nil {
		t.Fatal(v, e)
	}
}
func TestInstalledCodexHandlesAnIsolatedSignedOutAccountAndCleansUp(t *testing.T) {
	exe := os.Getenv("ATC_TEST_CODEX")
	if exe == "" {
		t.Skip("set ATC_TEST_CODEX to the installed Codex CLI")
	}
	s := core.Defaults()
	core.Obj(s["codex"])["command"] = exe
	core.Obj(s["codex"])["homeDir"] = t.TempDir()
	var client limitsClient
	v, e := client.read(s)
	if client.child != nil {
		t.Fatal("helper process not cleaned up")
	}
	switch {
	case e != nil && !strings.Contains(e.Error(), "Codex app-server response unavailable"):
		t.Fatal(e)
	case e == nil && v == nil:
		t.Fatal("ATC_TEST_CODEX was not found")
	case e == nil && core.Obj(v)["rateLimits"] != nil:
		t.Fatal("unexpected authenticated data", v)
	}
}
