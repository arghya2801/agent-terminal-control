package core

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Ported from src-tauri/src/index/cost.rs, codex_cost.rs and prices.rs.

func claudeLine(id, req, model, extra string) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":"2026-09-11T17:51:00.554Z","cwd":"D:/x","requestId":%q,"message":{"id":%q,"model":%q,"usage":{"input_tokens":1000000,"output_tokens":1000000,"cache_read_input_tokens":1000000,"cache_creation_input_tokens":2000000,"cache_creation":{"ephemeral_5m_input_tokens":1000000,"ephemeral_1h_input_tokens":1000000}%s}}}`, req, id, model, extra)
}
func claudeCosts(c *Costs, root string) []Object {
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = root
	Obj(s["codex"])["homeDir"] = filepath.Join(root, "absent-codex")
	return rowsOf(c.Rows(s, root))
}
func codexCosts(c *Costs, home string) []Object {
	s := Defaults()
	Obj(s["projects"])["claudeProjectsDir"] = filepath.Join(home, "absent-claude")
	Obj(s["codex"])["homeDir"] = home
	return rowsOf(c.Rows(s, home))
}
func rowsOf(v []any) []Object {
	out := []Object{}
	for _, r := range v {
		out = append(out, Obj(r))
	}
	return out
}
func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }
func totalInput(rows []Object) (n int64) {
	for _, r := range rows {
		n += number(r["input"])
	}
	return
}

func TestPricesEveryTokenKindAndFastModeDoubles(t *testing.T) {
	// 5 input + 25 output + 6.25 5m write + 10 1h write + 0.5 read
	for extra, want := range map[string]float64{"": 46.75, `,"speed":"fast"`: 93.5} {
		root := t.TempDir()
		os.WriteFile(filepath.Join(root, "s.jsonl"), []byte(claudeLine("m", "r", "claude-opus-5", extra)+"\n"), 0600)
		rows := claudeCosts(&Costs{}, root)
		if len(rows) != 1 || !near(Num(rows[0]["costUsd"]), want) || rows[0]["hour"] != "2026-09-11T17" {
			t.Fatal(extra, rows)
		}
	}
}
func TestOlderOpusIsNotPricedAsOpus45(t *testing.T) {
	p := prices(t.TempDir())
	for model, want := range map[string][2]float64{"claude-opus-4-1-20250805": {15, 75}, "claude-opus-4-5-20251101": {5, 25}, "claude-sonnet-4-6": {3, 15}, "claude-sonnet-5": {2, 10}} {
		r := priceFor(p, "claude", model)
		if r == nil || Num(r["input"]) != want[0] || Num(r["output"]) != want[1] {
			t.Error(model, r)
		}
	}
	if priceFor(p, "claude", "gpt-whatever") != nil {
		t.Error("a non-Claude model was priced")
	}
}
func TestRepeatedStreamingLinesCountOnceAndSyntheticIsSkipped(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "proj", "uuid", "subagents")
	os.MkdirAll(sub, 0700)
	a := claudeLine("m1", "r1", "claude-opus-5", "")
	os.WriteFile(filepath.Join(root, "proj", "s.jsonl"), []byte(a+"\n"+a+"\n"+claudeLine("m9", "r9", "<synthetic>", "")+"\nnot json\n"), 0600)
	os.WriteFile(filepath.Join(sub, "agent.jsonl"), []byte(claudeLine("m2", "r2", "claude-haiku-4-5", "")), 0600)
	var c Costs
	rows := claudeCosts(&c, root)
	models := map[string]int64{}
	for _, r := range rows {
		models[Str(r["model"])] = number(r["input"])
	}
	if len(rows) != 2 || models["claude-opus-5"] != 1000000 {
		t.Fatal("duplicate or synthetic line counted", rows)
	}
	if _, ok := models["claude-haiku-4-5"]; !ok {
		t.Fatal("subagent missed")
	}
	if !reflect.DeepEqual(Clone(claudeCosts(&c, root)), Clone(rows)) {
		t.Fatal("an unchanged rescan differs")
	}
}
func TestAGrownTranscriptIsParsedOnlyFromWhereTheLastScanStopped(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "s.jsonl")
	first := claudeLine("m1", "r1", "claude-opus-5", "")
	write(t, p, first+"\n")
	var c Costs
	if n := totalInput(claudeCosts(&c, root)); n != 1000000 {
		t.Fatal(n)
	}
	// Blank the first line in place while appending a second. A resumed read never looks
	// at the start again, so m1 still counts; a full re-read would drop it.
	write(t, p, strings.Repeat(" ", len(first))+"\n"+claudeLine("m2", "r2", "claude-opus-5", "")+"\n")
	if n := totalInput(claudeCosts(&c, root)); n != 2000000 {
		t.Fatal(n)
	}
}
func TestALineStillBeingWrittenIsCountedOnceWhenItCompletes(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "s.jsonl")
	a, b := claudeLine("m1", "r1", "claude-opus-5", ""), claudeLine("m2", "r2", "claude-opus-5", "")
	write(t, p, a+"\n"+b[:len(b)/2])
	var c Costs
	if n := totalInput(claudeCosts(&c, root)); n != 1000000 {
		t.Fatal(n)
	}
	write(t, p, a+"\n"+b)
	if n := totalInput(claudeCosts(&c, root)); n != 2000000 {
		t.Fatal("a complete final line without a newline still counts", n)
	}
	write(t, p, a+"\n"+b+"\n")
	if n := totalInput(claudeCosts(&c, root)); n != 2000000 {
		t.Fatal("counted twice", n)
	}
}
func TestAShrunkenTranscriptIsReadAgainFromTheStart(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "s.jsonl")
	a, b := claudeLine("m1", "r1", "claude-opus-5", ""), claudeLine("m2", "r2", "claude-opus-5", "")
	write(t, p, a+"\n"+b+"\n")
	var c Costs
	if n := totalInput(claudeCosts(&c, root)); n != 2000000 {
		t.Fatal(n)
	}
	write(t, p, b+"\n")
	if n := totalInput(claudeCosts(&c, root)); n != 1000000 {
		t.Fatal(n)
	}
}
func TestRowsCarryTheSessionAndSplitByIt(t *testing.T) {
	root := t.TempDir()
	proj := filepath.Join(root, "proj")
	os.MkdirAll(proj, 0700)
	// No sessionId on the line: the file stem stands in. An explicit sessionId wins.
	os.WriteFile(filepath.Join(proj, "aaa.jsonl"), []byte(claudeLine("m1", "r1", "claude-opus-5", "")+"\n"), 0600)
	withID := strings.Replace(claudeLine("m2", "r2", "claude-opus-5", ""), `"type":"assistant"`, `"type":"assistant","sessionId":"real-uuid"`, 1)
	os.WriteFile(filepath.Join(proj, "bbb.jsonl"), []byte(withID+"\n"), 0600)
	ids := []string{}
	for _, r := range claudeCosts(&Costs{}, root) {
		ids = append(ids, Str(r["sessionId"]))
	}
	sort.Strings(ids)
	if !reflect.DeepEqual(ids, []string{"aaa", "real-uuid"}) {
		t.Fatal("same hour and model must not merge sessions", ids)
	}
}
func TestUnknownModelsAreFlaggedNotPriced(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "s.jsonl"), []byte(claudeLine("m", "r", "mystery", "")+"\n"), 0600)
	rows := claudeCosts(&Costs{}, root)
	if len(rows) != 1 || rows[0]["unpriced"] != true || rows[0]["costUsd"] != nil {
		t.Fatal(rows)
	}
}

// --- prices.rs

func TestUserPriceEntriesOverrideAndExtendTheDefaults(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pricing.json"), []byte(`{"codex":[{"model":"gpt-5.5","input":1,"cached":0.1,"output":2},{"model":"gpt-7","input":3,"cached":0.3,"output":4}]}`), 0600)
	p := prices(dir)
	if Num(priceFor(p, "codex", "gpt-5.5")["input"]) != 1 || Num(priceFor(p, "codex", "gpt-7")["input"]) != 3 {
		t.Fatal(p["codex"])
	}
	if !reflect.DeepEqual(p["claude"], prices(t.TempDir())["claude"]) {
		t.Fatal("untouched section keeps defaults")
	}
}
func TestABadUserPriceFileKeepsTheDefaults(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "pricing.json"), []byte("{ nope"), 0600)
	if !reflect.DeepEqual(prices(dir), prices(t.TempDir())) {
		t.Fatal("a bad pricing.json changed the defaults")
	}
}

// --- codex_cost.rs

func TestEstimatesCachedInputWritesAndOutputWithoutDoubleCountingReasoning(t *testing.T) {
	rates := prices(t.TempDir())
	row := Object{"input": int64(100000), "cacheRead": int64(800000), "cacheWrite": int64(100000), "output": int64(20000), "reasoning": int64(10000)}
	for model, want := range map[string]float64{"gpt-6-astra": 4.05, "gpt-6-astra-2026-09-01": 4.05, "gpt-6-sol": 0.81, "gpt-6-luna-2026-09-22": 0.0405, "gpt-5.5": 1.5} {
		row["model"] = model
		priceCodexRow(row, rates)
		if row["costUsd"] == nil || math.Abs(Num(row["costUsd"])-want) > 1e-10 {
			t.Error(model, row["costUsd"], want)
		}
	}
	row["model"] = "gpt-5.5"
	if priceCodexRow(row, rates); row["unpriced"] != true {
		t.Error("gpt-5.5 has no cache-write rate, so the row is only partially priced")
	}
	for _, model := range []string{"codex-auto-review", "gpt-6-astra-pro", "gpt-5.4-mini", "gpt-6-astra-invalid"} {
		row["model"] = model
		priceCodexRow(row, rates)
		if row["costUsd"] != nil {
			t.Error(model, "was priced")
		}
	}
}

func codexTokens(input, output int64) Object {
	return Object{"input_tokens": input, "output_tokens": output, "cached_input_tokens": input / 2, "reasoning_output_tokens": output / 2, "total_tokens": input + output}
}
func codexEvent(kind string, payload Object) Object {
	return Object{"type": kind, "timestamp": "2026-09-20T10:00:00Z", "payload": payload}
}
func codexSnapshot(input, output int64) Object {
	return codexEvent("event_msg", Object{"type": "token_count", "info": Object{"total_token_usage": codexTokens(input, output)}})
}
func codexStructured(id string, input, output int64, total Object) Object {
	return codexEvent("token_usage", Object{"thread_id": "root", "response_id": id, "usage": codexTokens(input, output), "thread_token_usage": total})
}
func codexMeta(id string) Object {
	return codexEvent("session_meta", Object{"id": id, "cwd": `D:\app`, "timestamp": "2026-09-20T10:00:00Z"})
}
func writeRecords(t *testing.T, path string, rows ...Object) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0700)
	var b strings.Builder
	for _, r := range rows {
		j, _ := json.Marshal(r)
		b.Write(j)
		b.WriteByte('\n')
	}
	write(t, path, b.String())
}

func TestLegacyMetadataDoesNotTakeAnIDFromARoleRecord(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "sessions", "legacy.jsonl")
	writeRecords(t, path, codexEvent("response_item", Object{"id": "message-id", "timestamp": "2026-09-20T10:00:00Z", "role": "assistant"}), codexSnapshot(10, 2))
	for _, r := range codexCosts(&Costs{}, home) {
		if r["sessionId"] == "message-id" {
			t.Fatal("a role record supplied the session id")
		}
	}
	st, _ := os.Stat(path)
	reader := &codexReader{}
	reader.update(path, st)
	if reader.Meta != nil {
		t.Fatal("a role record was taken as session metadata", reader.Meta)
	}
}
func TestPricesDeduplicatedRowsAndPreservesUnknownModels(t *testing.T) {
	home := t.TempDir()
	writeRecords(t, filepath.Join(home, "sessions", "a.jsonl"), codexMeta("root"), codexEvent("turn_context", Object{"model": "gpt-6-astra"}), codexStructured("r1", 100, 20, codexTokens(100, 20)), codexSnapshot(100, 20))
	rows := codexCosts(&Costs{}, home)
	if len(rows) != 1 || math.Abs(Num(rows[0]["costUsd"])-0.00155) > 1e-10 || rows[0]["unpriced"] != false {
		t.Fatal(rows)
	}
}
func TestMixedRecordsDeduplicateResponsesAndSnapshotsWithoutCountingSubsetsTwice(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "sessions", "a.jsonl")
	writeRecords(t, path, codexMeta("root"), codexEvent("turn_context", Object{"model": "test-model"}),
		codexStructured("r1", 100, 20, codexTokens(100, 20)), codexSnapshot(100, 20), codexSnapshot(100, 20),
		codexStructured("r1", 100, 20, codexTokens(100, 20)), codexSnapshot(150, 30),
		codexStructured("r2", 50, 10, codexTokens(150, 30)), codexSnapshot(20, 4), codexSnapshot(20, 4))
	var c Costs
	rows := codexCosts(&c, home)
	if len(rows) != 1 {
		t.Fatal(rows)
	}
	r := rows[0]
	got := []any{number(r["totalTokens"]), number(r["input"]), number(r["cacheRead"]), number(r["output"]), number(r["reasoning"]), r["costUsd"], r["model"]}
	if !reflect.DeepEqual(got, []any{int64(180), int64(75), int64(75), int64(30), int64(15), nil, "test-model"}) {
		t.Fatal(got)
	}
	if !reflect.DeepEqual(Clone(codexCosts(&c, home)), Clone(rows)) {
		t.Fatal("an unchanged rescan differs")
	}
	b, _ := os.ReadFile(path)
	write(t, path, string(b)+`{"type":`)
	if !reflect.DeepEqual(Clone(codexCosts(&c, home)), Clone(rows)) {
		t.Fatal("a partial trailing record changed the totals")
	}
	rest, _ := json.Marshal(codexSnapshot(30, 6))
	write(t, path, string(b)+string(rest)+"\n")
	if n := number(codexCosts(&c, home)[0]["totalTokens"]); n != 180 {
		t.Fatal("a completed trailing snapshot was double counted", n)
	}
	writeRecords(t, path, codexMeta("root"), codexSnapshot(10, 2))
	if n := number(codexCosts(&c, home)[0]["totalTokens"]); n != 12 {
		t.Fatal("a rewritten file was not read again", n)
	}
}
func TestChildUsageUsesParentProjectAndKeepsRecordedModel(t *testing.T) {
	home := t.TempDir()
	writeRecords(t, filepath.Join(home, "sessions", "root.jsonl"), codexMeta("root"))
	writeRecords(t, filepath.Join(home, "sessions", "child.jsonl"),
		codexEvent("session_meta", Object{"id": "child", "parent_thread_id": "root", "cwd": `D:\elsewhere`, "timestamp": "2026-09-20T10:00:00Z"}),
		codexEvent("turn_context", Object{"model": "child-model"}), codexSnapshot(100, 20),
		codexEvent("turn_context", Object{"model": "next-model"}), codexSnapshot(200, 40))
	rows := codexCosts(&Costs{}, home)
	if len(rows) != 2 {
		t.Fatal(rows)
	}
	for _, r := range rows {
		if r["sessionId"] != "root" || r["projectKey"] != `d:\app` || number(r["totalTokens"]) != 120 {
			t.Fatal(r)
		}
	}
}
func TestLaggingSnapshotsNeverRecountStructuredThreadTotals(t *testing.T) {
	home := t.TempDir()
	events := []Object{codexMeta("root"), codexEvent("turn_context", Object{"model": "gpt-6-astra"})}
	for n := int64(1); n <= 100; n++ {
		events = append(events, codexSnapshot((n-1)*100, (n-1)*20), codexStructured(fmt.Sprintf("r%d", n), 100, 20, codexTokens(n*100, n*20)), codexSnapshot((n-1)*100, (n-1)*20))
	}
	writeRecords(t, filepath.Join(home, "sessions", "root.jsonl"), events...)
	var c Costs
	rows := codexCosts(&c, home)
	if number(rows[0]["totalTokens"]) != 12000 || math.Abs(Num(rows[0]["costUsd"])-0.155) > 1e-10 {
		t.Fatal(rows)
	}
	if !reflect.DeepEqual(Clone(codexCosts(&c, home)), Clone(rows)) {
		t.Fatal("an unchanged rescan differs")
	}
}
func TestLegacyOnlySnapshotsStillSupportCounterResets(t *testing.T) {
	home := t.TempDir()
	writeRecords(t, filepath.Join(home, "sessions", "root.jsonl"), codexMeta("root"),
		codexSnapshot(100, 20), codexSnapshot(100, 20), codexSnapshot(150, 30), codexSnapshot(20, 4), codexSnapshot(20, 4), codexSnapshot(30, 6))
	if n := number(codexCosts(&Costs{}, home)[0]["totalTokens"]); n != 216 {
		t.Fatal(n)
	}
}

// Read-only audit of a real Codex home, as in Rust: opt in with ATC_AUDIT_CODEX_HOME.
func TestAuditLocalUsageTotals(t *testing.T) {
	home := os.Getenv("ATC_AUDIT_CODEX_HOME")
	if home == "" {
		t.Skip("set ATC_AUDIT_CODEX_HOME to audit a real Codex home")
	}
	var tokens int64
	var cost float64
	for _, r := range codexCosts(&Costs{}, home) {
		tokens += number(r["totalTokens"])
		cost += Num(r["costUsd"])
	}
	t.Logf("Deduplicated local Codex usage: %d tokens, $%.2f baseline API estimate", tokens, cost)
}
