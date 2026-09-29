package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// Ported from src-tauri/src/index/session.rs and src-tauri/tests/fixtures_contract.rs.

const headBytes = 512 * 1024
const headLines = 300

func fixtureProjects(t *testing.T) string {
	t.Helper()
	root, e := filepath.Abs("../../fixtures/claude-projects")
	if e != nil {
		t.Fatal(e)
	}
	return root
}
func readSession(t *testing.T, path string) Object {
	t.Helper()
	st, e := os.Stat(path)
	if e != nil {
		t.Fatal(e)
	}
	return ClaudeSession(path, st)
}
func fixtureSession(t *testing.T, project, stem string) Object {
	t.Helper()
	return readSession(t, filepath.Join(fixtureProjects(t), project, stem+".jsonl"))
}
func fixtureText(t *testing.T, rel string) string {
	t.Helper()
	b, e := os.ReadFile(filepath.Join(fixtureProjects(t), filepath.FromSlash(rel)))
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func wantLabel(t *testing.T, s Object, label, source string) {
	t.Helper()
	if s["label"] != label || s["labelSource"] != source {
		t.Fatalf("got %q (%v), want %q (%s)", s["label"], s["labelSource"], label, source)
	}
}

const gameTracker = "D--Coding-game-tracker-app"

func TestSubagentTranscriptsAreNotListedAsSessions(t *testing.T) {
	// A recursive walk would report 4 here. Depth 1 only.
	files := Files(filepath.Join(fixtureProjects(t), gameTracker), false)
	if len(files) != 3 {
		t.Fatal(files)
	}
	for _, f := range files {
		if strings.Contains(f, "subagents") {
			t.Fatal(f)
		}
	}
}
func TestAMissingDirectoryYieldsNoSessionsRatherThanErroring(t *testing.T) {
	if f := Files(filepath.Join(fixtureProjects(t), "does-not-exist"), false); len(f) != 0 {
		t.Fatal(f)
	}
}
func TestCwdComesFromTheTranscriptNotTheDirectoryName(t *testing.T) {
	if cwd := fixtureSession(t, gameTracker, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa")["cwd"]; cwd != `D:\Coding\game_tracker_app` {
		t.Fatal(cwd)
	}
}
func TestAiTitleWinsWhenPresent(t *testing.T) {
	wantLabel(t, fixtureSession(t, gameTracker, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"), "Game tracker professional grade", "aiTitle")
}
func TestSlugIsUsedWhenThereIsNoAiTitle(t *testing.T) {
	s := fixtureSession(t, gameTracker, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb")
	wantLabel(t, s, "quiet-cuddling-lampson", "slug")
	if s["gitBranch"] != "feat/stats" {
		t.Fatal(s["gitBranch"])
	}
}
func TestTheFirstHumanMessageIsUsedWhenThereIsNeither(t *testing.T) {
	// Hidden behind snapshot runs and two decoy turns, stored as a block array.
	wantLabel(t, fixtureSession(t, gameTracker, "cccccccc-3333-4333-8333-cccccccccccc"), "fix the scoreboard sort order please", "firstMessage")
}
func TestSlashCommandsAndCaveatsAreNotMistakenForTheFirstMessage(t *testing.T) {
	label := Str(fixtureSession(t, gameTracker, "cccccccc-3333-4333-8333-cccccccccccc")["label"])
	if strings.Contains(label, "command-name") || strings.Contains(label, "caveat") {
		t.Fatal(label)
	}
}
func TestATrivialFirstMessageFallsThroughToTheUuid(t *testing.T) {
	wantLabel(t, fixtureSession(t, "D--Coding-portfolio2", "dddddddd-4444-4444-8444-dddddddddddd"), "dddddddd", "uuid")
}
func TestALateAiTitleStillWinsOverAnEarlierMessage(t *testing.T) {
	wantLabel(t, fixtureSession(t, "D--Coding-portfolio2", "1a1a1a1a-8888-4888-8888-1a1a1a1a1a1a"), "Run Astro portfolio with pnpm", "aiTitle")
}
func TestATruncatedFinalLineDoesNotLoseTheRestOfTheHead(t *testing.T) {
	s := fixtureSession(t, "D--Coding-portfolio2", "eeeeeeee-5555-4555-8555-eeeeeeeeeeee")
	if s["label"] != "Portfolio refresh" || s["cwd"] != `D:\Coding\portfolio2` {
		t.Fatal(s)
	}
}
func TestATranscriptWithNoCwdInBudgetIsMarkedUntrusted(t *testing.T) {
	// 688KB of snapshots and no cwd anywhere. Must not invent a path.
	s := fixtureSession(t, "D--Coding-headless", "99999999-7777-4777-8777-999999999999")
	if s["cwd"] != nil || s["labelSource"] != "uuid" {
		t.Fatal(s)
	}
}
func TestTheByteBudgetActuallyBoundsTheRead(t *testing.T) {
	// A cwd placed past the byte budget must never be seen. Few, long lines so the
	// line budget is not what stops the read.
	p := filepath.Join(t.TempDir(), "s.jsonl")
	big := `{"type":"progress","data":"` + strings.Repeat("x", 4096) + "\"}\n"
	lines := headBytes/len(big) + 2
	if lines >= headLines {
		t.Fatal("the byte budget must be the limit under test")
	}
	body := strings.Repeat(big, lines) + `{"type":"user","cwd":"D:/beyond/the/budget","message":{"content":"late"}}` + "\n"
	os.WriteFile(p, []byte(body), 0600)
	s := readSession(t, p)
	if s["cwd"] != nil {
		t.Fatal("a line past the byte budget was parsed")
	}
	if number(s["size"]) <= headBytes {
		t.Fatal("size is reported from metadata, not the read")
	}
}
func TestADeletedCwdIsStillReported(t *testing.T) {
	s := fixtureSession(t, "D--Coding-deleted-project", "ffffffff-6666-4666-8666-ffffffffffff")
	if s["cwd"] != `D:\Coding\deleted_project_xyz` || s["label"] != "Long gone experiment" {
		t.Fatal(s)
	}
}
func TestMtimeAndSizeArePopulatedForCacheKeying(t *testing.T) {
	s := fixtureSession(t, gameTracker, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa")
	if number(s["mtimeMs"]) <= 0 || number(s["size"]) <= 0 {
		t.Fatal(s)
	}
}

func agentName(name string) string {
	return fmt.Sprintf(`{"type":"agent-name","agentName":%q,"sessionId":"x"}`, name)
}

// About 1KB of a record the parser ignores, newline included.
func fillerLine() string { return `{"type":"progress","data":"` + strings.Repeat("x", 1000) + "\"}\n" }

func TestTheLatestAgentNameWinsEvenFarPastTheHeadBudget(t *testing.T) {
	// An ai-title early, a first name past the 512KB head, then a rename near the end.
	p := filepath.Join(t.TempDir(), "s.jsonl")
	body := strings.Join([]string{
		`{"type":"user","cwd":"D:/p","message":{"content":"hi there"}}`,
		`{"type":"ai-title","aiTitle":"Summary of the first prompt"}`,
		strings.Repeat(fillerLine(), 600), agentName("first-name"),
		strings.Repeat(fillerLine(), 10), agentName("renamed-later"),
		strings.Repeat(fillerLine(), 5),
	}, "\n")
	os.WriteFile(p, []byte(body), 0600)
	wantLabel(t, readSession(t, p), "renamed-later", "agentName")
}
func TestAnAgentNameInTheHeadIsUsedWhenTheTailHasNone(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.jsonl")
	os.WriteFile(p, []byte(agentName("early-name")+"\n"+strings.Repeat(fillerLine(), 100)), 0600)
	wantLabel(t, readSession(t, p), "early-name", "agentName")
}
func TestLongLabelsAreTruncatedAndWhitespaceCollapsed(t *testing.T) {
	if got := Tidy("a  b\n\tc", true); got != "a b c" {
		t.Fatal(got)
	}
	got := Tidy(strings.Repeat("x", 200), true)
	if utf8.RuneCountInString(got) > 72 || !strings.HasSuffix(got, "…") {
		t.Fatal(got)
	}
}

// --- fixture corpus contract: if someone regenerates fixtures/claude-projects, these
// fail before a parser test silently stops testing anything.

func TestFixtureCorpusExists(t *testing.T) {
	if !IsDir(fixtureProjects(t)) {
		t.Fatal("fixture corpus missing; run `node scripts/make-fixtures.mjs`")
	}
}
func TestFixtureSubagentTranscriptsAreNestedNotSiblings(t *testing.T) {
	if n := len(Files(filepath.Join(fixtureProjects(t), gameTracker), false)); n != 3 {
		t.Fatal(n)
	}
	nested := filepath.Join(fixtureProjects(t), gameTracker, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", "subagents", "agent-explore-1.jsonl")
	if st, e := os.Stat(nested); e != nil || st.IsDir() {
		t.Fatal("the subagent transcript trap is missing")
	}
}
func TestFixtureMangledDirNameDisagreesWithTheRealPath(t *testing.T) {
	if !strings.Contains(fixtureText(t, gameTracker+"/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl"), `D:\\Coding\\game_tracker_app`) {
		t.Fatal("fixture should record an underscored cwd that the dir name cannot represent")
	}
}
func TestFixtureLabelPrecedenceCasesAreAllPresent(t *testing.T) {
	ai := fixtureText(t, gameTracker+"/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl")
	slug := fixtureText(t, gameTracker+"/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.jsonl")
	msg := fixtureText(t, gameTracker+"/cccccccc-3333-4333-8333-cccccccccccc.jsonl")
	dot := fixtureText(t, "D--Coding-portfolio2/dddddddd-4444-4444-8444-dddddddddddd.jsonl")
	switch {
	case !strings.Contains(ai, `"type":"ai-title"`):
		t.Fatal("aiTitle case missing")
	case strings.Contains(slug, "ai-title") || !strings.Contains(slug, `"slug"`):
		t.Fatal("slug case broken")
	case strings.Contains(msg, "ai-title") || strings.Contains(msg, `"slug"`) || !strings.Contains(msg, `"content":[{"type":"text"`):
		t.Fatal("first-message case should use the block-array content shape")
	case !strings.Contains(dot, `"content":"."`):
		t.Fatal("the `.` message case is missing")
	}
}
func TestFixtureFirstHumanMessageSitsPastTheNaiveLineBudget(t *testing.T) {
	for i, line := range strings.Split(fixtureText(t, gameTracker+"/cccccccc-3333-4333-8333-cccccccccccc.jsonl"), "\n") {
		if strings.Contains(line, "fix the scoreboard sort order") {
			if i < 10 {
				t.Fatalf("human message at line %d, too shallow to test the budget", i)
			}
			return
		}
	}
	t.Fatal("the deep human message is missing")
}
func TestFixtureNonHumanTurnsArePresentToBeFilteredOut(t *testing.T) {
	body := fixtureText(t, gameTracker+"/cccccccc-3333-4333-8333-cccccccccccc.jsonl")
	for _, decoy := range []string{"local-command-caveat", "command-name", `"isMeta":true`} {
		if !strings.Contains(body, decoy) {
			t.Fatal(decoy, "decoy missing")
		}
	}
}
func TestFixtureTruncatedFinalLineIsActuallyTruncated(t *testing.T) {
	lines := strings.Split(strings.TrimRight(fixtureText(t, "D--Coding-portfolio2/eeeeeeee-5555-4555-8555-eeeeeeeeeeee.jsonl"), "\r\n"), "\n")
	var v any
	if json.Unmarshal([]byte(lines[len(lines)-1]), &v) == nil {
		t.Fatal("final line should be unparseable so the parser's quiet-bail path is exercised")
	}
}
func TestFixtureHeadlessSessionExceedsTheByteBudgetWithNoCwd(t *testing.T) {
	body := fixtureText(t, "D--Coding-headless/99999999-7777-4777-8777-999999999999.jsonl")
	if len(body) <= headBytes || strings.Contains(body, `"cwd"`) {
		t.Fatal("headless fixture must exceed the byte budget and never record a cwd")
	}
}
func TestFixtureDeletedProjectPathDoesNotExist(t *testing.T) {
	if !strings.Contains(fixtureText(t, "D--Coding-deleted-project/ffffffff-6666-4666-8666-ffffffffffff.jsonl"), "deleted_project_xyz") {
		t.Fatal("deleted-project fixture changed")
	}
	if _, e := os.Stat(`D:\Coding\deleted_project_xyz`); e == nil {
		t.Fatal("the `missing path` fixture only tests anything while that path stays absent")
	}
}
func TestFixtureEmptyProjectDirHasNoSessions(t *testing.T) {
	if f := Files(filepath.Join(fixtureProjects(t), "D--Coding-empty"), false); len(f) != 0 {
		t.Fatal(f)
	}
}
