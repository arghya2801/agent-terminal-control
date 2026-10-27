package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// brief is an item in one line, enough to compare a whole transcript at a glance.
func brief(items []Object) []string {
	out := []string{}
	for _, it := range items {
		s := Str(it["kind"])
		for _, k := range []string{"id", "tool", "input", "text"} {
			if v := Str(it[k]); v != "" {
				s += " " + v
			}
		}
		if Bool(it["error"]) {
			s += " !"
		}
		out = append(out, s)
	}
	return out
}
func transcriptFixture(name string) string {
	p, _ := filepath.Abs("../../fixtures/transcripts/" + name)
	return p
}

// offsetAfter is the byte offset just past the line holding marker.
func offsetAfter(t *testing.T, path, marker string) int64 {
	t.Helper()
	b, _ := os.ReadFile(path)
	i := strings.Index(string(b), marker)
	if i < 0 {
		t.Fatal(marker)
	}
	return int64(i + strings.IndexByte(string(b[i:]), '\n') + 1)
}
func expect(t *testing.T, got Object, want ...string) {
	t.Helper()
	items, _ := got["items"].([]Object)
	if g, w := strings.Join(brief(items), "\n"), strings.Join(want, "\n"); g != w {
		t.Fatalf("got\n%s\nwant\n%s", g, w)
	}
}

func TestClaudeTranscript(t *testing.T) {
	path := transcriptFixture("claude.jsonl")
	got := TranscriptRead("claude", path, 0, "")
	// The rewind at p3 drops everything after the first turn; the compact keeps history.
	expect(t, got,
		"user fix the flaky resize test",
		"thinking The resize runs before layout.",
		"assistant I'll look at the resize path first.",
		"tool t1 Read src/terminal/manager.ts",
		"tool t2 Bash npm test -- resize",
		"result t1",
		"result t2 !",
		"tool t3 Edit src/terminal/manager.ts",
		"result t3",
		"assistant Fixed.",
		"turn",
		"user actually, open a PR instead",
		"notice Conversation compacted",
		"user continue",
	)
	items := got["items"].([]Object)
	if Str(items[6]["output"]) != "1 failing\nresize garbles" || Str(items[7]["body"]) != "-a\n+b\n+c\n" || items[10]["durationMs"] != float64(134000) {
		t.Fatal(items[6], items[7], items[10])
	}
	if got["last"] != "n1" || got["reset"] != false || got["offset"].(int64) != offsetAfter(t, path, `"uuid":"n1"`) {
		t.Fatal(got["last"], got["reset"], got["offset"])
	}
}

func TestClaudeTranscriptIncremental(t *testing.T) {
	path := transcriptFixture("claude.jsonl")
	// Parallel tool results point at their own call, not the record before: no rewind.
	got := TranscriptRead("claude", path, offsetAfter(t, path, `"uuid":"a4"`), "a4")
	if got["reset"] != false || Str(got["items"].([]Object)[0]["kind"]) != "result" {
		t.Fatal(got)
	}
	// The read starts at the command; the slash command, its output and the next prompt
	// show until p3 rewinds to d1, which is before this read: read everything again.
	got = TranscriptRead("claude", path, offsetAfter(t, path, `"uuid":"d1"`), "d1")
	if got["reset"] != true || len(got["items"].([]Object)) != 14 {
		t.Fatal(got)
	}
	// A rewind whose parent is in the same read drops the abandoned branch in place.
	got = TranscriptRead("claude", path, offsetAfter(t, path, `"uuid":"a6"`), "a6")
	expect(t, got, "turn", "user actually, open a PR instead", "notice Conversation compacted", "user continue")
	// What the rewind abandoned: a slash command, its output, a denied call.
	b, _ := os.ReadFile(path)
	cut := filepath.Join(t.TempDir(), "s.jsonl")
	os.WriteFile(cut, b[:offsetAfter(t, path, `"uuid":"i1"`)], 0600)
	got = TranscriptRead("claude", cut, offsetAfter(t, path, `"uuid":"d1"`), "d1")
	expect(t, got, "user /model opus", "notice Set model to opus", "user now push it", "tool t4 Bash git push", "result t4 !", "notice Interrupted")
}

func TestTranscriptPartialLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	line := `{"type":"user","uuid":"u1","origin":{"kind":"human"},"message":{"content":"hi"}}` + "\n"
	os.WriteFile(path, []byte(line+`{"type":"assistant","uuid":"a1","mess`), 0600)
	got := TranscriptRead("claude", path, 0, "")
	expect(t, got, "user hi")
	if got["offset"].(int64) != int64(len(line)) {
		t.Fatal(got["offset"])
	}
}

func TestTranscriptCaps(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	var b strings.Builder
	for i := 0; i < maxItems+5; i++ {
		fmt.Fprintf(&b, `{"type":"user","uuid":"u%d","parentUuid":"u%d","origin":{"kind":"human"},"message":{"content":"%d"}}`+"\n", i, i-1, i)
	}
	os.WriteFile(path, []byte(b.String()), 0600)
	got := TranscriptRead("claude", path, 0, "")
	if got["dropped"] != 5 || Str(got["items"].([]Object)[0]["text"]) != "5" {
		t.Fatal(got["dropped"])
	}
	if s := clip("héllo", 2); s != "h…" {
		t.Fatal(s)
	}
}

func TestCodexTranscript(t *testing.T) {
	got := TranscriptRead("codex", transcriptFixture("codex.jsonl"), 0, "")
	expect(t, got,
		"user list the files",
		"thinking Planning a directory listing",
		"tool c1 exec Get-ChildItem -Name",
		"result c1",
		`tool c2 clock.sleep {"duration_ms":1000}`,
		"result c2",
		"assistant Two files.",
		"turn",
		"notice Interrupted",
	)
	items := got["items"].([]Object)
	if Str(items[3]["output"]) != "Script completed\na.txt" || items[7]["durationMs"] != float64(4200) {
		t.Fatal(items[3], items[7])
	}
}
