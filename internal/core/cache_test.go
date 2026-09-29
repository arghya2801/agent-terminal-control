package core

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Ported from src-tauri/src/index/cache.rs, index/mod.rs and index/codex.rs. Rust counted
// parser calls through an injected closure; here a re-parse is observed instead by giving
// the head a label that only a re-parse would pick up.

func cacheSettings(claudeRoot string) Object {
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = claudeRoot
	Obj(s["codex"])["homeDir"] = filepath.Join(claudeRoot, "absent-codex")
	return s
}

// One project directory holding one transcript; returns the transcript path and settings.
func oneTranscript(t *testing.T, body string) (string, Object) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "project")
	os.MkdirAll(dir, 0700)
	path := filepath.Join(dir, "s.jsonl")
	write(t, path, body)
	return path, cacheSettings(root)
}
func write(t *testing.T, path, body string) {
	t.Helper()
	if e := os.WriteFile(path, []byte(body), 0600); e != nil {
		t.Fatal(e)
	}
	// Distinct mtimes even on coarse filesystem clocks.
	future := time.Now().Add(time.Duration(len(body)) * time.Millisecond)
	os.Chtimes(path, future, future)
}
func onlySession(t *testing.T, snap Object) Object {
	t.Helper()
	for _, p := range projectsOf(snap) {
		for _, s := range sessionsOf(p) {
			return s
		}
	}
	t.Fatal("no session", snap)
	return nil
}
func title(s string) string { return `{"type":"ai-title","aiTitle":"` + s + `"}` + "\n" }

func TestASecondLookupOfAnUnchangedFileDoesNotReparse(t *testing.T) {
	_, s := oneTranscript(t, title("Label"))
	var idx Index
	idx.Scan(s, false)
	idx.Scan(s, false)
	if idx.Hits != 1 {
		t.Fatal(idx.Hits)
	}
}
func TestAnAppendedFileIsNotReparsedButItsMtimeUpdates(t *testing.T) {
	// Claude appends to the live session constantly, and the head never changes.
	path, s := oneTranscript(t, title("Label"))
	var idx Index
	first := onlySession(t, idx.Scan(s, false))
	// Grow the file but change the head: only a re-parse would see "Other".
	write(t, path, title("Other")+"appended appended appended\n")
	second := onlySession(t, idx.Scan(s, false))
	if second["label"] != "Label" {
		t.Fatal("an append must not force a re-parse", second)
	}
	if number(second["size"]) <= number(first["size"]) || number(second["mtimeMs"]) < number(first["mtimeMs"]) {
		t.Fatal("recency must stay current", first, second)
	}
}
func TestARenameAppendedToAGrowingFileUpdatesTheCachedLabel(t *testing.T) {
	path, s := oneTranscript(t, agentName("old-name")+"\n")
	var idx Index
	idx.Scan(s, false)
	write(t, path, agentName("old-name")+"\n"+agentName("new-name")+"\n")
	hits := idx.Hits
	got := onlySession(t, idx.Scan(s, false))
	if idx.Hits != hits+1 {
		t.Fatal("the head is still not re-parsed")
	}
	wantLabel(t, got, "new-name", "agentName")
}
func TestAShrunkenFileIsReparsed(t *testing.T) {
	// Truncation means the head really could have changed.
	path, s := oneTranscript(t, title("Long original title here"))
	var idx Index
	idx.Scan(s, false)
	write(t, path, title("Short"))
	wantLabel(t, onlySession(t, idx.Scan(s, false)), "Short", "aiTitle")
}
func TestAGrownFileWhoseHeadNeverYieldedALabelIsRetried(t *testing.T) {
	// The head budget may simply not have reached the label yet.
	path, s := oneTranscript(t, "x\n")
	var idx Index
	if onlySession(t, idx.Scan(s, false))["labelSource"] != "uuid" {
		t.Fatal("fixture should start unlabelled")
	}
	write(t, path, "x\n"+title("Real Title"))
	wantLabel(t, onlySession(t, idx.Scan(s, false)), "Real Title", "aiTitle")
}
func TestCacheRoundTripsThroughDisk(t *testing.T) {
	_, s := oneTranscript(t, title("Label"))
	cache := filepath.Join(t.TempDir(), "cache", "index.json")
	(&Index{CachePath: cache}).Scan(s, false)
	if _, e := os.Stat(cache + ".tmp"); e == nil {
		t.Fatal("temp file left behind")
	}
	reloaded := Index{CachePath: cache}
	reloaded.Scan(s, false)
	if reloaded.Hits != 1 {
		t.Fatal("a persisted cache must survive restart", reloaded.Hits)
	}
}
func TestASchemaBumpOrCorruptCacheIsDiscardedRatherThanFatal(t *testing.T) {
	_, s := oneTranscript(t, title("Label"))
	for _, body := range []string{`{"Version":999,"Files":{"x":{}}}`, "not json at all"} {
		cache := filepath.Join(t.TempDir(), "index.json")
		os.WriteFile(cache, []byte(body), 0600)
		idx := Index{CachePath: cache}
		if onlySession(t, idx.Scan(s, false))["label"] != "Label" || idx.Hits != 0 {
			t.Fatal(body)
		}
	}
}
func TestACodexFileWithoutMetadataDoesNotDirtyTheCacheOnEveryScan(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "codex", "sessions"), 0700)
	os.WriteFile(filepath.Join(root, "codex", "sessions", "empty.jsonl"), []byte("{}\n"), 0600)
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(root, "absent")
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "codex")
	cache := filepath.Join(root, "index.json")
	idx := Index{CachePath: cache}
	idx.Scan(s, false)
	old := time.Now().Add(-time.Hour)
	os.Chtimes(cache, old, old)
	idx.Scan(s, false)
	if st, _ := os.Stat(cache); !st.ModTime().Equal(old) {
		t.Fatal("an unchanged metadata-less file rewrote the cache")
	}
}
func TestDeletedSessionsAreEvicted(t *testing.T) {
	path, s := oneTranscript(t, title("A"))
	write(t, filepath.Join(filepath.Dir(path), "b.jsonl"), title("B"))
	var idx Index
	if n := number(idx.Scan(s, false)["sessionCount"]); n != 2 {
		t.Fatal(n)
	}
	os.Remove(path)
	if n := number(idx.Scan(s, false)["sessionCount"]); n != 1 || len(idx.cache) != 1 {
		t.Fatal(n, len(idx.cache))
	}
}

// --- index/mod.rs

func TestDiscoverySkipsSubagentTranscripts(t *testing.T) {
	files := ClaudeFiles(fixtureProjects(t))
	for _, f := range files {
		if strings.Contains(f, "subagents") {
			t.Fatal(f)
		}
	}
	// 3 game-tracker + 3 portfolio2 + 1 deleted-project + 1 headless.
	if len(files) != 8 {
		t.Fatal(files)
	}
}
func TestAMissingRootYieldsNothingRatherThanErroring(t *testing.T) {
	if f := ClaudeFiles(filepath.Join(fixtureProjects(t), "nope")); len(f) != 0 {
		t.Fatal(f)
	}
}
func claudeFixtureSettings(t *testing.T) Object {
	return cacheSettings(fixtureProjects(t))
}
func TestScanningTheCorpusGroupsItIntoProjects(t *testing.T) {
	var idx Index
	snap := idx.Scan(claudeFixtureSettings(t), false)
	names := map[string]int{}
	for _, p := range projectsOf(snap) {
		names[Str(p["name"])] = len(sessionsOf(p))
	}
	// The underscore proves cwd was read rather than the directory name decoded.
	if number(snap["sessionCount"]) != 8 || names["portfolio2"] == 0 || names["Unknown"] == 0 {
		t.Fatal(names)
	}
	if names["game_tracker_app"] != 3 {
		t.Fatal("a recursive walk would say 4", names)
	}
}
func TestARescanThatChangesNothingKeepsTheProjectionKey(t *testing.T) {
	var idx Index
	s := claudeFixtureSettings(t)
	first := ProjectionKey(idx.Scan(s, false))
	if ProjectionKey(idx.Scan(s, false)) != first || ProjectionKey(idx.Scan(s, false)) != first {
		t.Fatal("nothing changed but the projection did")
	}
}
func TestActivityTimestampsDoNotChangeTheProjectionKey(t *testing.T) {
	var idx Index
	snap := idx.Scan(claudeFixtureSettings(t), false)
	before := ProjectionKey(snap)
	for _, p := range projectsOf(snap) {
		p["lastActiveMs"] = number(p["lastActiveMs"]) + 1
		for _, s := range sessionsOf(p) {
			s["mtimeMs"] = number(s["mtimeMs"]) + 1
		}
	}
	if ProjectionKey(snap) != before {
		t.Fatal("timestamps changed the rendered projection")
	}
	Obj(Arr(Obj(Arr(snap["projects"])[0])["sessions"])[0])["label"] = "renamed"
	if ProjectionKey(snap) == before {
		t.Fatal("a label change must change the projection")
	}
}
func TestTheCachePersistsBetweenScans(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "index.json")
	s := claudeFixtureSettings(t)
	(&Index{CachePath: cache}).Scan(s, false)
	if _, e := os.Stat(cache); e != nil {
		t.Fatal("cache should have been written")
	}
	second := Index{CachePath: cache}
	second.Scan(s, false)
	if second.Hits == 0 {
		t.Fatal("a warm cache should hit")
	}
}
func TestForcingAScanBypassesTheCache(t *testing.T) {
	var idx Index
	s := claudeFixtureSettings(t)
	idx.Scan(s, false)
	idx.Scan(s, true)
	if idx.Hits != 0 {
		t.Fatal("force must re-parse", idx.Hits)
	}
}

// --- index/codex.rs

func codexFixture(t *testing.T) string {
	t.Helper()
	p, _ := filepath.Abs("../../fixtures/codex")
	return p
}
func TestDiscoversCliEditorDesktopAndOldMetadataWithoutChildren(t *testing.T) {
	var sessions []Object
	for _, p := range Files(filepath.Join(codexFixture(t), "sessions"), true) {
		st, _ := os.Stat(p)
		r := &codexReader{}
		r.update(p, st)
		if r.Meta != nil && !r.Child && !r.Archived {
			sessions = append(sessions, r.Meta)
		}
	}
	byID := map[string]Object{}
	var current Object
	for _, s := range sessions {
		byID[Str(s["id"])] = s
		if strings.HasPrefix(Str(s["id"]), "aaaa") {
			current = s
		}
	}
	if len(sessions) != 5 || byID["legacy-id"] == nil || byID["missing"] == nil || byID["missing"]["cwd"] != nil || current == nil {
		t.Fatal(sessions)
	}
	if current["label"] != "Build the Codex sidebar" || current["activity"] != "working" || number(current["createdAtMs"]) != 1758362400000+365*86400000 {
		t.Fatal(current)
	}
	var idx Index
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(codexFixture(t), "absent")
	Obj(s["codex"])["homeDir"] = codexFixture(t)
	for _, p := range projectsOf(idx.Scan(s, false)) {
		for _, x := range sessionsOf(p) {
			if x["id"] == current["id"] && x["label"] != "Renamed Codex session" {
				t.Fatal("session_index rename not applied", x)
			}
		}
	}
}
func TestIncrementalCachePreservesNativeIDAndRetriesPartialRecords(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "codex", "sessions")
	os.MkdirAll(dir, 0700)
	b, _ := os.ReadFile(filepath.Join(codexFixture(t), "sessions", "2026", "09", "20", "rollout-current.jsonl"))
	path := filepath.Join(dir, "rollout-not-the-id.jsonl")
	write(t, path, string(b))
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(root, "absent")
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "codex")
	cache := filepath.Join(root, "cache.json")
	idx := Index{CachePath: cache}
	if id := Str(onlySession(t, idx.Scan(s, false))["id"]); !strings.HasPrefix(id, "aaaa") {
		t.Fatal("native id lost", id)
	}
	write(t, path, string(b)+"{\"type\":\"task_complete\"}}\n")
	second := onlySession(t, idx.Scan(s, false))
	if second["activity"] != "idle" || number(second["activitySequence"]) != 2 {
		t.Fatal(second)
	}
	reloaded := Index{CachePath: cache}
	if got := onlySession(t, reloaded.Scan(s, false)); !reflect.DeepEqual(Clone(got), Clone(second)) || reloaded.Hits != 1 {
		t.Fatal(got, reloaded.Hits)
	}
}
func TestMixedIndexSeparatesIdenticalIdsAndAppliesProviderRenames(t *testing.T) {
	s := Defaults()
	Obj(s["codex"])["homeDir"] = codexFixture(t)
	Obj(s["projects"])["claudeProjectsDir"] = fixtureProjects(t)
	id := "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
	Obj(s["projects"])["sessionNames"] = Object{id: "Legacy Claude name"}
	idx := Index{CachePath: filepath.Join(t.TempDir(), "cache.json")}
	snap := idx.Scan(s, false)
	labels := map[string]any{}
	for _, p := range projectsOf(snap) {
		for _, x := range sessionsOf(p) {
			if x["id"] == id {
				labels[Str(x["provider"])] = x["label"]
			}
		}
	}
	if !reflect.DeepEqual(labels, map[string]any{"claude": "Legacy Claude name", "codex": "Renamed Codex session"}) {
		t.Fatal(labels)
	}
	if !reflect.DeepEqual(Clone(idx.Scan(s, true)), Clone(snap)) {
		t.Fatal("a forced scan changed the snapshot")
	}
}
