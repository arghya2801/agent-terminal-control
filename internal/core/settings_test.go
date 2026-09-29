package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Ported from src-tauri/src/paths.rs, agent.rs, settings/{mod,model,tasks}.rs.

func key(p string) string { return PathKey(Resolve(p)) }
func here(t *testing.T) string {
	t.Helper()
	d, e := os.Getwd()
	if e != nil {
		t.Fatal(e)
	}
	return d
}

// --- paths.rs

func TestARealDirectoryResolvesAndExists(t *testing.T) {
	if !IsDir(Resolve(here(t))) {
		t.Fatal(Resolve(here(t)))
	}
}
func TestResolvedPathsNeverCarryAVerbatimPrefix(t *testing.T) {
	// `\\?\D:\...` breaks ConPTY and would never match a cwd from session JSONL.
	if p := Resolve(`\\?\` + here(t)); strings.HasPrefix(p, `\\?\`) || strings.HasPrefix(key(p), `\\?\`) {
		t.Fatal(p)
	}
}
func TestSpellingsDoNotCreateASecondProject(t *testing.T) {
	h := here(t)
	for _, other := range []string{strings.ToUpper(h), strings.ReplaceAll(h, `\`, "/"), h + `\`} {
		if key(other) != key(h) {
			t.Errorf("%q keys as %q, want %q", other, key(other), key(h))
		}
	}
}
func TestADeletedDirectoryStillGetsAStableKey(t *testing.T) {
	gone := `D:\Coding\deleted_project_xyz`
	if IsDir(gone) || key(gone) != `d:\coding\deleted_project_xyz` || key(gone+`\`) != key(gone) {
		t.Fatal(key(gone))
	}
}
func TestLexicalFallbackNormalizesDotSegments(t *testing.T) {
	if k := key(`D:\Coding\foo\.\bar\..\baz_missing`); k != `d:\coding\foo\baz_missing` {
		t.Fatal(k)
	}
}
func TestUnderscoresArePreserved(t *testing.T) {
	if k := key(`D:\Coding\game_tracker_app`); k != `d:\coding\game_tracker_app` {
		t.Fatal(k)
	}
}
func TestClaudeProjectsDirHonoursAnOverrideAndDefaultsUnderTheProfile(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = `D:\fixtures\projects`
	if c, _ := Roots(s); c != `D:\fixtures\projects` {
		t.Fatal(c)
	}
	// Blank means "unset", not "a directory named ''".
	for _, v := range []any{"  ", nil} {
		Obj(s["projects"])["claudeProjectsDir"] = v
		if c, _ := Roots(s); c != filepath.Join(Home(), ".claude", "projects") {
			t.Fatal(v, c)
		}
	}
}

// --- agent.rs

func TestCommandsQuotePathsIdsAndHomeAsLiteralPowerShellArguments(t *testing.T) {
	s := Defaults()
	Obj(s["codex"])["command"] = `C:\O'Brien\codex.exe`
	Obj(s["codex"])["homeDir"] = `D:\Codex home\$literal`
	for _, c := range []struct{ provider, session, want string }{
		{"codex", "id';$(bad)", `$env:CODEX_HOME = 'D:\Codex home\$literal'; & 'C:\O''Brien\codex.exe' resume 'id'';$(bad)'`},
		{"claude", "abc", "claude --resume abc"},
		{"claude", "", "claude"},
	} {
		if got := AgentCommand(s, c.provider, c.session, false); got != c.want {
			t.Errorf("%q != %q", got, c.want)
		}
	}
}
func TestCodexRunsStandaloneWhenTheHostJobForbidsBreakaway(t *testing.T) {
	if got := AgentCommand(Defaults(), "codex", "abc", true); got != "codex --no-daemon resume abc" {
		t.Fatal(got)
	}
	if got := AgentCommand(Defaults(), "claude", "", true); got != "claude" {
		t.Fatal(got)
	}
}
func TestSimpleArgumentsStayReadableAndExpressionsStayLiteral(t *testing.T) {
	if got := AgentCommand(Defaults(), "codex", "", false); got != "codex" {
		t.Fatal(got)
	}
	if Argument("0199-abc") != "0199-abc" {
		t.Fatal(Argument("0199-abc"))
	}
	for _, v := range []string{"", "two words", "$(whoami)", "a;b", "a`nb", "a'b", "@foo", "#comment"} {
		if Argument(v) != Quote(v) {
			t.Errorf("%q was not quoted: %q", v, Argument(v))
		}
	}
}

// --- settings/mod.rs

func TestAMissingSettingsFileYieldsDefaults(t *testing.T) {
	s, e := LoadSettings(filepath.Join(t.TempDir(), "settings.json"))
	if e != nil || !reflect.DeepEqual(Clone(s), Clone(Defaults())) {
		t.Fatal(s, e)
	}
}
func TestAPartialSettingsFileLoads(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	os.WriteFile(p, []byte(`{"ui":{"sidebarWidth":320}}`), 0600)
	s, e := LoadSettings(p)
	if e != nil || number(Obj(s["ui"])["sidebarWidth"]) != 320 || number(Obj(s["ui"])["sessionsPerProject"]) != 15 {
		t.Fatal(s, e)
	}
}
func TestSaveThenLoadRoundTripsAndLeavesNoTempFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested")
	p := filepath.Join(dir, "settings.json")
	s := Defaults()
	Obj(s["ui"])["sidebarOpen"] = false
	Obj(s["projects"])["claudeProjectsDir"] = `D:\fixtures`
	if e := Save(p, s); e != nil {
		t.Fatal(e)
	}
	back, e := LoadSettings(p)
	if e != nil || !reflect.DeepEqual(Clone(back), Clone(s)) {
		t.Fatal(back, e)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatal("temp file left behind", entries)
	}
}
func TestTheConfigDirCanBeRedirectedForThePlayground(t *testing.T) {
	t.Setenv("ATC_CONFIG_DIR", `D:\playground\config`)
	if d := ConfigDir(); d != `D:\playground\config` {
		t.Fatal(d)
	}
	// A relative spelling must come back absolute, or the watcher never matches (#67).
	t.Setenv("ATC_CONFIG_DIR", "./playground/config")
	if d := ConfigDir(); !filepath.IsAbs(d) || !strings.HasSuffix(d, filepath.Join("playground", "config")) {
		t.Fatal(d)
	}
}
func TestTheConfigFolderIsNamedForTheProductNotTheAuthor(t *testing.T) {
	t.Setenv("ATC_CONFIG_DIR", "")
	if d := ConfigDir(); filepath.Base(d) != "Agent Terminal Control" {
		t.Fatal(d)
	}
}
func TestMigrationCarriesSettingsFromTheOldDirectoryAsACopy(t *testing.T) {
	d := t.TempDir()
	legacy, current := filepath.Join(d, "dev.arghya.ccpg"), filepath.Join(d, "dev.arghya.atc")
	os.MkdirAll(legacy, 0700)
	os.WriteFile(filepath.Join(legacy, "settings.json"), []byte(`{"ui":{"zoom":1.5}}`), 0600)
	if !MigrateSettings(legacy, current) {
		t.Fatal("declined")
	}
	s, e := LoadSettings(filepath.Join(current, "settings.json"))
	if e != nil || Num(Obj(s["ui"])["zoom"]) != 1.5 {
		t.Fatal(s, e)
	}
	if _, e := os.Stat(filepath.Join(legacy, "settings.json")); e != nil {
		t.Fatal("a copy, not a move: the original must stay")
	}
}
func TestMigrationNeverOverwritesExistingSettings(t *testing.T) {
	d := t.TempDir()
	legacy, current := filepath.Join(d, "old"), filepath.Join(d, "new")
	os.MkdirAll(legacy, 0700)
	os.MkdirAll(current, 0700)
	os.WriteFile(filepath.Join(legacy, "settings.json"), []byte(`{"ui":{"zoom":2.0}}`), 0600)
	os.WriteFile(filepath.Join(current, "settings.json"), []byte(`{"ui":{"zoom":1.0}}`), 0600)
	if MigrateSettings(legacy, current) {
		t.Fatal("should decline")
	}
	if s, _ := LoadSettings(filepath.Join(current, "settings.json")); Num(Obj(s["ui"])["zoom"]) != 1 {
		t.Fatal("existing settings must win")
	}
}
func TestMigrationIsIdempotentAndQuietWhenThereIsNothingToDo(t *testing.T) {
	d := t.TempDir()
	legacy, current := filepath.Join(d, "absent"), filepath.Join(d, "new")
	if MigrateSettings(legacy, current) {
		t.Fatal("migrated from nothing")
	}
	os.MkdirAll(legacy, 0700)
	os.WriteFile(filepath.Join(legacy, "settings.json"), []byte("{}"), 0600)
	if !MigrateSettings(legacy, current) || MigrateSettings(legacy, current) {
		t.Fatal("must copy exactly once")
	}
}
func TestOnlyDirectoryAndProjectionChangesNeedARescan(t *testing.T) {
	// #87: a font or view change must not restart the watcher or rescan.
	prev := Defaults()
	cosmetic := Obj(Clone(prev))
	Obj(cosmetic["ui"])["zoom"] = 1.5
	Obj(cosmetic["ui"])["sidebarView"] = "tasks"
	Obj(cosmetic["terminal"])["fontSize"] = 20
	named := Obj(Clone(prev))
	Obj(named["projects"])["names"] = Object{`D:\atc`: "atc"}
	moved := Obj(Clone(prev))
	Obj(moved["codex"])["homeDir"] = `D:\codex`
	scratch := Obj(Clone(prev))
	Obj(scratch["claude"])["scratchDir"] = `D:\scratch`
	config := t.TempDir()
	if ProjectionChanged(prev, cosmetic, config) {
		t.Fatal("a cosmetic change rescanned")
	}
	for name, next := range map[string]Object{"rename": named, "codex home": moved, "scratch": scratch} {
		if !ProjectionChanged(prev, next, config) {
			t.Error(name, "did not rescan")
		}
	}
}

// --- settings/model.rs

func TestAnEmptyObjectYieldsAllDefaultsAndUnknownFieldsAreIgnored(t *testing.T) {
	// A file written by a newer build must still load in an older one.
	for _, text := range []string{`{}`, `{"somethingNew":42,"ui":{"whatever":true}}`} {
		s, e := ParseSettings([]byte(text))
		if e != nil || !reflect.DeepEqual(Clone(s), Clone(Defaults())) {
			t.Fatal(text, s, e)
		}
	}
}
func TestAPartialFileKeepsDefaultsForEverythingElse(t *testing.T) {
	s, e := ParseSettings([]byte(`{"ui":{"sidebarOpen":false},"terminal":{"fontSize":16}}`))
	if e != nil {
		t.Fatal(e)
	}
	ui, term := Obj(s["ui"]), Obj(s["terminal"])
	if ui["sidebarOpen"] != false || number(ui["sidebarWidth"]) != 260 || Str(Obj(s["claude"])["command"]) != "claude" {
		t.Fatal(ui)
	}
	// Editing one terminal field must not blank the rest of the section.
	if number(term["fontSize"]) != 16 || number(term["scrollback"]) != 10000 || !strings.Contains(Str(term["fontFamily"]), "FiraCode") || Num(ui["zoom"]) != 1 || ui["notifications"] != true {
		t.Fatal(term, ui)
	}
}
func TestSettingsRoundTripThroughJSONInCamelCase(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{Object{"path": `D:\Coding\atc`, "displayName": "atc", "order": 0.0}}
	Obj(s["ui"])["zoom"] = 1.25
	b, _ := json.Marshal(s)
	text := string(b)
	// The frontend reads this file too; snake_case would silently not bind.
	if !strings.Contains(text, `"zoom":1.25`) || !strings.Contains(text, "sessionsPerProject") || !strings.Contains(text, "claudeProjectsDir") || strings.Contains(text, "sessions_per_project") {
		t.Fatal(text)
	}
	back, e := ParseSettings(b)
	if e != nil || !reflect.DeepEqual(Clone(back), Clone(s)) {
		t.Fatal(back, e)
	}
}
func TestTasksRoundTripAndTolerateHandEdits(t *testing.T) {
	tasks, e := ParseTasks([]byte(`[{"id":3,"title":"t","state":"doing","branches":["main"]},{"id":4,"state":"blocked"}]`))
	if e != nil {
		t.Fatal(e)
	}
	first, second := Obj(tasks[0]), Obj(tasks[1])
	if first["state"] != "doing" || first["repo"] != nil || second["state"] != "todo" || len(Arr(second["sessions"])) != 0 {
		t.Fatal(tasks)
	}
	b, _ := json.Marshal(tasks)
	back, e := ParseTasks(b)
	if e != nil || !strings.Contains(string(b), `"state":"doing"`) || !reflect.DeepEqual(Clone(back), Clone(tasks)) {
		t.Fatal(string(b), e)
	}
}
func TestTheScratchDirectoryDefaultsUnderTheConfigDirectory(t *testing.T) {
	s := Defaults()
	if Obj(s["claude"])["scratchDir"] != nil || Scratch(s, `D:\cfg`) != `D:\cfg\scratch` {
		t.Fatal(Scratch(s, `D:\cfg`))
	}
	Obj(s["claude"])["scratchDir"] = "  "
	if Scratch(s, `D:\cfg`) != `D:\cfg\scratch` {
		t.Fatal("blank means default")
	}
}

// --- settings/tasks.rs

func TestAMissingTasksFileIsAnEmptyListAndTasksRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "tasks.json")
	if got, e := LoadTasks(p); e != nil || len(got) != 0 {
		t.Fatal(got, e)
	}
	tasks := NormalizeTasks([]any{Object{"id": 1.0, "title": "t1"}, Object{"id": 2.0, "title": "t2"}})
	Save(p, tasks)
	if got, e := LoadTasks(p); e != nil || !reflect.DeepEqual(Clone(got), Clone(tasks)) {
		t.Fatal(got, e)
	}
}
