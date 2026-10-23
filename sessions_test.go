package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"atc/internal/core"
)

func TestTranscriptsPreviewAndSearch(t *testing.T) {
	a := NewApp(t.TempDir())
	a.load()
	claude, codex := t.TempDir(), t.TempDir()
	core.Obj(a.settings["projects"])["claudeProjectsDir"] = claude
	core.Obj(a.settings["codex"])["homeDir"] = codex
	os.MkdirAll(filepath.Join(claude, "p"), 0700)
	os.MkdirAll(filepath.Join(codex, "sessions"), 0700)
	cl := filepath.Join(claude, "p", "c1.jsonl")
	os.WriteFile(cl, []byte(strings.Join([]string{
		`{"type":"user","sessionId":"c1","message":{"content":"<command-name>/clear</command-name>"}}`,
		`{"type":"user","sessionId":"c1","timestamp":"2026-10-20T10:00:00Z","message":{"content":"Fix the Login redirect"}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at auth.ts"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}`,
		`not json`,
	}, "\n")+"\n"), 0600)
	os.WriteFile(filepath.Join(codex, "sessions", "x.jsonl"), []byte(strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"t9"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>login</environment_context>"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"why does login fail"}]}}`,
		`{"type":"response_item","payload":{"type":"function_call","name":"shell"}}`,
	}, "\n")+"\n"), 0600)

	turns, e := a.SessionPreview(cl)
	want := []Turn{{"user", "Fix the Login redirect"}, {"assistant", "Looking at auth.ts"}, {"tool", "Read, Edit"}}
	if e != nil || !reflect.DeepEqual(turns, want) {
		t.Fatal(turns, e)
	}
	if _, e := a.SessionPreview(filepath.Join(a.config, "settings.json")); e == nil {
		t.Fatal("read a file outside the transcript folders")
	}

	hits, _ := a.SearchTranscripts("LOGIN")
	got := map[string]string{}
	for _, h := range hits {
		got[h.Session] = h.Snippet
	}
	if len(hits) != 2 || got["claude:c1"] != "Fix the Login redirect" || got["codex:t9"] != "why does login fail" {
		t.Fatal(hits)
	}
}
