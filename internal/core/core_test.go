package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func fixtureSettings(t *testing.T) Object {
	t.Helper()
	root, e := filepath.Abs("../../fixtures")
	if e != nil {
		t.Fatal(e)
	}
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(root, "claude-projects")
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "codex")
	return s
}
func TestSettingsDefaultsAndPartial(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	if e := os.WriteFile(p, []byte(`{"ui":{"sidebarOpen":false},"terminal":{"fontSize":16},"unknown":42}`), 0600); e != nil {
		t.Fatal(e)
	}
	s, e := LoadSettings(p)
	if e != nil {
		t.Fatal(e)
	}
	if Bool(Obj(s["ui"])["sidebarOpen"]) || number(Obj(s["terminal"])["fontSize"]) != 16 || number(Obj(s["ui"])["sidebarWidth"]) != 260 {
		t.Fatal(s)
	}
	if _, ok := s["unknown"]; ok {
		t.Fatal("unknown setting retained")
	}
	if e = Save(p, s); e != nil {
		t.Fatal(e)
	}
	again, e := LoadSettings(p)
	if e != nil || !reflect.DeepEqual(Clone(s), Clone(again)) {
		t.Fatal(again, e)
	}
}
func TestMalformedSettingsPreserved(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	os.WriteFile(p, []byte("{bad"), 0600)
	_, e := LoadSettings(p)
	if e == nil {
		t.Fatal("expected error")
	}
	b, _ := os.ReadFile(p)
	if string(b) != "{bad" {
		t.Fatal("file overwritten")
	}
}
func TestTaskStateTolerance(t *testing.T) {
	for _, state := range []any{nil, 42, true, Object{}, []any{}, "blocked"} {
		task := Obj(NormalizeTasks([]any{Object{"state": state}})[0])
		if task["state"] != "todo" || task["branches"] == nil || task["sessions"] == nil {
			t.Fatal(task)
		}
	}
}
func TestAgentQuoting(t *testing.T) {
	s := Defaults()
	Obj(s["codex"])["command"] = `C:\O'Brien\codex.exe`
	Obj(s["codex"])["homeDir"] = `D:\Codex home\$literal`
	got := AgentCommand(s, "codex", "id';$(bad)", false)
	want := `$env:CODEX_HOME = 'D:\Codex home\$literal'; & 'C:\O''Brien\codex.exe' resume 'id'';$(bad)'`
	if got != want {
		t.Fatalf("%q != %q", got, want)
	}
	if AgentCommand(Defaults(), "codex", "abc", true) != "codex --no-daemon resume abc" {
		t.Fatal("missing no-daemon")
	}
}
func TestFixtureDiscovery(t *testing.T) {
	s := fixtureSettings(t)
	var idx Index
	snap := idx.Scan(s, true)
	if number(snap["sessionCount"]) != 13 {
		t.Fatalf("count %v", snap["sessionCount"])
	}
	found := false
	for _, pv := range Arr(snap["projects"]) {
		p := Obj(pv)
		for _, sv := range Arr(p["sessions"]) {
			ss := Obj(sv)
			if ss["label"] == "Renamed Codex session" {
				found = true
			}
			if strings.Contains(Str(ss["file"]), "subagents") {
				t.Fatal("child listed")
			}
		}
	}
	if !found {
		t.Fatal("missing latest name")
	}
	if !reflect.DeepEqual(Clone(snap), Clone(idx.Scan(s, false))) {
		t.Fatal("warm scan differs")
	}
}
func TestPartialRecordsRetried(t *testing.T) {
	p := filepath.Join(t.TempDir(), "rollout.jsonl")
	os.WriteFile(p, []byte("{\"type\":\"session_meta\",\"payload\":{\"id\":\"native-id\",\"timestamp\":\"2026-09-20T10:00:00Z\"}}\n{\"type\":\"event_msg\",\"payload\":"), 0600)
	r := &codexReader{}
	st, _ := os.Stat(p)
	r.update(p, st)
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString("{\"type\":\"task_complete\"}}\n")
	f.Close()
	st, _ = os.Stat(p)
	r.update(p, st)
	if r.Meta["id"] != "native-id" || r.Meta["activity"] != "idle" || number(r.Meta["activitySequence"]) != 1 {
		t.Fatal(r.Meta)
	}
}
func TestUserPricingAndUnknownModels(t *testing.T) {
	dir := t.TempDir()
	Save(filepath.Join(dir, "pricing.json"), Object{"codex": []any{Object{"model": "gpt-5.5", "input": 9.0, "cached": 1.0, "output": 50.0}}})
	p := prices(dir)
	if Num(priceFor(p, "codex", "gpt-5.5")["input"]) != 9 {
		t.Fatal("override ignored")
	}
	if priceFor(p, "codex", "gpt-5.5-invented") != nil {
		t.Fatal("broad prefix matched")
	}
	if priceFor(p, "codex", "gpt-5.5-2026-09-01") == nil {
		t.Fatal("dated snapshot absent")
	}
}
func TestFixtureCostsStable(t *testing.T) {
	var c Costs
	s := fixtureSettings(t)
	rows := c.Rows(s, t.TempDir())
	if len(rows) == 0 {
		t.Fatal("no costs")
	}
	if !reflect.DeepEqual(Clone(rows), Clone(c.Rows(s, t.TempDir()))) {
		t.Fatal("warm costs changed")
	}
	for _, v := range rows {
		r := Obj(v)
		if number(r["input"]) < 0 || number(r["totalTokens"]) < number(r["output"]) {
			t.Fatal(r)
		}
	}
}
// rust-contract.json is the index and cost output of the retired Rust implementation over
// the fixture corpus, frozen when Go replaced it. Only regenerate it (from this Go output)
// for a deliberate behaviour change, never to make a regression pass.
func TestRustFixtureContract(t *testing.T) {
	path := "../../fixtures/rust-contract.json"
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var expected Object
	if e = json.Unmarshal(b, &expected); e != nil {
		t.Fatal(e)
	}
	s := fixtureSettings(t)
	var idx Index
	var c Costs
	actual := Object{"snapshot": idx.Scan(s, true), "costs": c.Rows(s, t.TempDir())}
	normalize := func(v any) any {
		b, _ := json.Marshal(v)
		var o any
		json.Unmarshal(b, &o)
		var walk func(any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				delete(x, "mtimeMs")
				delete(x, "lastActiveMs")
				delete(x, "file")
				delete(x, "exists")
				for _, v := range x {
					walk(v)
				}
			case []any:
				for _, v := range x {
					walk(v)
				}
			}
		}
		walk(o)
		return o
	}
	a, w := normalize(actual), normalize(expected)
	if !reflect.DeepEqual(a, w) {
		ab, _ := json.MarshalIndent(a, "", "  ")
		wb, _ := json.MarshalIndent(w, "", "  ")
		os.WriteFile(filepath.Join(t.TempDir(), "actual.json"), ab, 0600)
		t.Fatalf("Go differs from Rust fixture contract\nactual: %s\nexpected: %s", ab, wb)
	}
}

func TestInvalidSettingsRejected(t *testing.T) {
	for _, text := range []string{`null`, `{"ui":null}`, `{"ui":{"zoom":"large"}}`, `{"terminal":{"fontSize":-1}}`, `{"claude":{"resumeArgs":null}}`, `{"projects":{"names":{"x":42}}}`} {
		if _, e := ParseSettings([]byte(text)); e == nil {
			t.Errorf("accepted %s", text)
		}
	}
}
func TestClaudeCostsDeduplicateAndCountAllTokenKinds(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "projects", "session", "subagents")
	os.MkdirAll(dir, 0700)
	record := Object{"type": "assistant", "timestamp": "2026-09-20T12:00:00Z", "cwd": root, "sessionId": "parent", "requestId": "req", "message": Object{"id": "m", "model": "claude-opus-5", "usage": Object{"input_tokens": 1000000, "output_tokens": 1000000, "cache_read_input_tokens": 1000000, "cache_creation_input_tokens": 2000000, "cache_creation": Object{"ephemeral_5m_input_tokens": 1000000, "ephemeral_1h_input_tokens": 1000000}}}}
	b, _ := json.Marshal(record)
	path := filepath.Join(dir, "agent.jsonl")
	os.WriteFile(path, append(append(b, '\n'), append(b, '\n')...), 0600)
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = root
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "absent")
	var c Costs
	rows := c.Rows(s, t.TempDir())
	if len(rows) != 1 {
		t.Fatal(rows)
	}
	r := Obj(rows[0])
	if Num(r["costUsd"]) != 46.75 || number(r["totalTokens"]) != 5000000 {
		t.Fatal(r)
	}
	Obj(Obj(record["message"])["usage"])["speed"] = "fast"
	Obj(record["message"])["id"] = "m2"
	b, _ = json.Marshal(record)
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	f.Write(append(b, '\n'))
	f.Close()
	rows = c.Rows(s, t.TempDir())
	if cost := Num(Obj(rows[0])["costUsd"]); cost != 140.25 {
		t.Fatal(cost)
	}
}
func TestClaudeUsageWithoutFinalNewline(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "s.jsonl"), []byte(`{"type":"assistant","timestamp":"2026-09-20T12:00:00Z","message":{"id":"m","model":"unknown","usage":{"input_tokens":10}}}`), 0600)
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = root
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "absent")
	var c Costs
	rows := c.Rows(s, t.TempDir())
	if len(rows) != 1 || !Bool(Obj(rows[0])["unpriced"]) {
		t.Fatal(rows)
	}
}
func TestCodexResponseUsageReplacesLaterCumulativeSnapshots(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sessions")
	os.MkdirAll(dir, 0700)
	records := []Object{
		{"type": "session_meta", "payload": Object{"id": "thread", "timestamp": "2026-09-20T10:00:00Z", "cwd": root}},
		{"type": "turn_context", "payload": Object{"model": "gpt-5.5"}},
		{"type": "event_msg", "timestamp": "2026-09-20T10:00:01Z", "payload": Object{"type": "token_count", "info": Object{"total_token_usage": Object{"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}}}},
		{"type": "token_usage", "timestamp": "2026-09-20T10:00:02Z", "payload": Object{"response_id": "r1", "usage": Object{"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}, "thread_token_usage": Object{"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}}},
		{"type": "event_msg", "timestamp": "2026-09-20T10:00:03Z", "payload": Object{"type": "token_count", "info": Object{"total_token_usage": Object{"input_tokens": 500, "output_tokens": 50, "total_tokens": 550}}}},
		{"type": "token_usage", "timestamp": "2026-09-20T10:00:04Z", "payload": Object{"response_id": "r2", "usage": Object{"input_tokens": 20, "output_tokens": 5, "total_tokens": 25}}},
	}
	var text strings.Builder
	for _, r := range records {
		b, _ := json.Marshal(r)
		text.Write(b)
		text.WriteByte('\n')
	}
	text.WriteString(text.String())
	os.WriteFile(filepath.Join(dir, "rollout.jsonl"), []byte(text.String()), 0600)
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(root, "absent")
	Obj(s["codex"])["homeDir"] = root
	var c Costs
	rows := c.Rows(s, t.TempDir())
	if len(rows) != 1 || number(Obj(rows[0])["totalTokens"]) != 135 {
		t.Fatal(rows)
	}
}

func TestAtomicSaveWhileFileIsRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tasks.json")
	if e := Save(path, []any{}); e != nil {
		t.Fatal(e)
	}
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			select {
			case <-done:
				return
			default:
				_, _ = os.ReadFile(path)
			}
		}
	}()
	defer func() { close(done); <-finished }()
	for i := 0; i < 30; i++ {
		if e := Save(path, []any{Object{"id": i}}); e != nil {
			t.Fatal(e)
		}
	}
}
func TestIndexCacheRestartRewriteRemovalAndPins(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "claude", "project")
	os.MkdirAll(dir, 0700)
	path := filepath.Join(dir, "test.jsonl")
	cwd := filepath.Join(root, "repo")
	os.MkdirAll(cwd, 0700)
	makeText := func(label string) []byte {
		b, _ := json.Marshal(Object{"type": "user", "cwd": cwd, "message": Object{"content": label}})
		return append(b, '\n')
	}
	os.WriteFile(path, makeText("first title"), 0600)
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Dir(dir)
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "codex")
	cache := filepath.Join(root, "cache.json")
	idx := Index{CachePath: cache}
	first := idx.Scan(s, false)
	restart := Index{CachePath: cache}
	if !reflect.DeepEqual(Clone(first), Clone(restart.Scan(s, false))) {
		t.Fatal("disk cache changed snapshot")
	}
	os.WriteFile(path, makeText("other title"), 0600)
	future := time.Now().Add(time.Second)
	os.Chtimes(path, future, future)
	snap := restart.Scan(s, false)
	project := Obj(Arr(snap["projects"])[0])
	session := Obj(Arr(project["sessions"])[0])
	if session["label"] != "other title" {
		t.Fatal("same-size replacement not detected", session)
	}
	Obj(s["projects"])["pinned"] = []any{Object{"path": cwd, "displayName": "Pinned repo", "order": float64(0)}}
	Obj(s["projects"])["names"] = Object{cwd: "Custom repo"}
	Obj(s["projects"])["sessionNames"] = Object{"test": "Legacy name", "claude:test": "Provider name"}
	snap = restart.Scan(s, false)
	project = Obj(Arr(snap["projects"])[0])
	session = Obj(Arr(project["sessions"])[0])
	if project["name"] != "Custom repo" || project["pinned"] != true || session["label"] != "Provider name" {
		t.Fatal(project)
	}
	os.Remove(path)
	snap = restart.Scan(s, false)
	if number(snap["sessionCount"]) != 0 || len(Arr(snap["projects"])) != 1 {
		t.Fatal("empty pinned project lost", snap)
	}
	Obj(s["projects"])["pinned"] = []any{}
	if len(Arr(restart.Scan(s, false)["projects"])) != 0 {
		t.Fatal("deleted transcript retained")
	}
}
