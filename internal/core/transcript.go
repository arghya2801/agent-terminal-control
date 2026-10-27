package core

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// ponytail: fixed caps keep a read small enough for one Wails reply. Fetch a range on
// demand if the chat ever needs whole outputs or more history than maxItems.
const (
	textCap   = 64 * 1024
	outputCap = 8 * 1024
	maxItems  = 1000
)

var (
	commandName = regexp.MustCompile(`(?s)<command-name>(.*?)</command-name>`)
	commandArgs = regexp.MustCompile(`(?s)<command-args>(.*?)</command-args>`)
	commandOut  = regexp.MustCompile(`(?s)<local-command-stdout>(.*?)</local-command-stdout>`)
	execCmd     = regexp.MustCompile(`cmd:\s*("(?:[^"\\]|\\.)*")`)
)

type transcript struct {
	items []Object
	marks map[string]int // Claude record uuid -> how many items there were after it
	last  string
	full  bool
	reset bool
}

// TranscriptRead turns a session file's records from offset on into chat items, the same
// shape for both providers. A `result` item carries the id of the `tool` item it answers.
// last is the uuid of the Claude record read just before offset. A typed prompt whose
// parent is some other record is a rewind: the items after that parent are dropped, and
// when the parent came before offset the whole file is read again with reset set.
func TranscriptRead(provider, path string, offset int64, last string) Object {
	t := &transcript{items: []Object{}, marks: map[string]int{}, last: last, full: offset == 0}
	next := ReadRecords(path, offset, func(v Object) {
		if t.reset {
			return
		}
		if provider == "codex" {
			t.codex(v)
		} else {
			t.claude(v)
		}
	})
	if t.reset {
		out := TranscriptRead(provider, path, 0, "")
		out["reset"] = true
		return out
	}
	dropped := max(0, len(t.items)-maxItems)
	return Object{"items": t.items[dropped:], "offset": next, "last": t.last, "reset": false, "dropped": dropped}
}

func (t *transcript) add(kind string, at int64, item Object) {
	item["kind"] = kind
	item["at"] = at
	t.items = append(t.items, item)
}

func (t *transcript) claude(v Object) {
	id := Str(v["uuid"])
	if id == "" || Bool(v["isSidechain"]) {
		return
	}
	at := stamp(v["timestamp"])
	switch Str(v["type"]) {
	case "assistant":
		for _, b := range Arr(Obj(v["message"])["content"]) {
			c := Obj(b)
			switch Str(c["type"]) {
			case "text":
				t.add("assistant", at, Object{"text": clip(Str(c["text"]), textCap)})
			case "thinking":
				if s := Str(c["thinking"]); s != "" {
					t.add("thinking", at, Object{"text": clip(s, textCap)})
				}
			case "tool_use":
				name := Str(c["name"])
				summary, body := claudeInput(name, Obj(c["input"]))
				t.add("tool", at, Object{"id": Str(c["id"]), "tool": name, "input": summary, "body": body})
			}
		}
	case "user":
		if !Bool(v["isMeta"]) {
			t.claudeUser(v, at)
		}
	case "system":
		switch Str(v["subtype"]) {
		case "turn_duration":
			t.add("turn", at, Object{"durationMs": v["durationMs"]})
		case "compact_boundary":
			t.add("notice", at, Object{"text": "Conversation compacted"})
		}
	}
	t.last = id
	t.marks[id] = len(t.items)
}

func (t *transcript) claudeUser(v Object, at int64) {
	for _, b := range Arr(Obj(v["message"])["content"]) {
		if c := Obj(b); Str(c["type"]) == "tool_result" {
			t.add("result", at, Object{"id": Str(c["tool_use_id"]), "output": clip(joined(c["content"]), outputCap), "error": Bool(c["is_error"])})
		}
	}
	txt, human := humanText(v)
	switch {
	case strings.HasPrefix(txt, "[Request interrupted"):
		t.add("notice", at, Object{"text": "Interrupted"})
	case commandName.MatchString(txt):
		t.rewind(Str(v["parentUuid"]))
		cmd := commandName.FindStringSubmatch(txt)[1]
		if m := commandArgs.FindStringSubmatch(txt); m != nil {
			cmd += " " + m[1]
		}
		t.add("user", at, Object{"text": strings.TrimSpace(cmd)})
	case commandOut.MatchString(txt):
		if out := strings.TrimSpace(commandOut.FindStringSubmatch(txt)[1]); out != "" {
			t.add("notice", at, Object{"text": clip(out, outputCap)})
		}
	case human && txt != "":
		t.rewind(Str(v["parentUuid"]))
		t.add("user", at, Object{"text": clip(txt, textCap)})
	}
}

func (t *transcript) rewind(parent string) {
	if parent == "" || parent == t.last {
		return
	}
	if n, ok := t.marks[parent]; ok {
		t.items = t.items[:n]
	} else if !t.full {
		t.reset = true
	}
}

// claudeInput is a tool call's one-line summary and the body shown when it is opened.
// Edits become -/+ lines, so one renderer draws them and Codex's patches.
func claudeInput(name string, in Object) (string, string) {
	switch name {
	case "Bash":
		c := Str(in["command"])
		return firstLine(c), clip(c, outputCap)
	case "Edit":
		return Str(in["file_path"]), diff(Str(in["old_string"]), Str(in["new_string"]))
	case "MultiEdit":
		var b strings.Builder
		for _, e := range Arr(in["edits"]) {
			b.WriteString(diff(Str(Obj(e)["old_string"]), Str(Obj(e)["new_string"])))
		}
		return Str(in["file_path"]), clip(b.String(), outputCap)
	case "Write":
		return Str(in["file_path"]), clip(Str(in["content"]), outputCap)
	case "AskUserQuestion":
		var lines []string
		for _, q := range Arr(in["questions"]) {
			lines = append(lines, Str(Obj(q)["question"]))
			for _, o := range Arr(Obj(q)["options"]) {
				lines = append(lines, "- "+Str(Obj(o)["label"]))
			}
		}
		return firstLine(strings.Join(lines, "\n")), clip(strings.Join(lines, "\n"), outputCap)
	case "ExitPlanMode":
		return "Plan", clip(Str(in["plan"]), textCap)
	}
	summary := ""
	for _, k := range []string{"file_path", "pattern", "url", "description", "query", "prompt", "skill"} {
		if summary = Str(in[k]); summary != "" {
			break
		}
	}
	if summary == "" {
		keys := make([]string, 0, len(in))
		for k := range in {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if summary = Str(in[k]); summary != "" {
				break
			}
		}
	}
	b, _ := json.MarshalIndent(in, "", "  ")
	return firstLine(summary), clip(string(b), outputCap)
}

func diff(old, new string) string {
	var b strings.Builder
	for _, l := range strings.Split(old, "\n") {
		b.WriteString("-" + l + "\n")
	}
	for _, l := range strings.Split(new, "\n") {
		b.WriteString("+" + l + "\n")
	}
	return clip(b.String(), outputCap)
}

func (t *transcript) codex(v Object) {
	p := v
	if x, ok := v["payload"]; ok {
		p = Obj(x)
	}
	at := stamp(v["timestamp"])
	kind := Str(p["type"])
	if Str(v["type"]) == "event_msg" {
		switch kind {
		case "task_complete", "turn_complete", "turn_completed":
			t.add("turn", at, Object{"durationMs": p["duration_ms"]})
		case "turn_aborted", "task_interrupted", "turn_interrupted":
			t.add("notice", at, Object{"text": "Interrupted"})
		}
		return
	}
	switch kind {
	case "message":
		txt := strings.TrimSpace(joined(p["content"]))
		if txt == "" {
			return
		}
		switch Str(p["role"]) {
		case "user":
			if !codexInjected(txt) {
				t.add("user", at, Object{"text": clip(txt, textCap)})
			}
		case "assistant":
			t.add("assistant", at, Object{"text": clip(txt, textCap)})
		}
	case "reasoning":
		if s := strings.TrimSpace(joined(p["summary"])); s != "" {
			t.add("thinking", at, Object{"text": clip(s, textCap)})
		}
	case "function_call", "custom_tool_call":
		name, input := Str(p["name"]), Str(p["arguments"])
		if ns := Str(p["namespace"]); ns != "" {
			name = ns + "." + name
		}
		if kind == "custom_tool_call" {
			input = Str(p["input"])
		}
		t.add("tool", at, Object{"id": Str(p["call_id"]), "tool": name, "input": codexSummary(input), "body": clip(input, outputCap)})
	case "function_call_output", "custom_tool_call_output":
		t.add("result", at, Object{"id": Str(p["call_id"]), "output": clip(joined(p["output"]), outputCap), "error": false})
	}
}

// codexSummary finds the command in a call's input: `cmd:"..."` inside the JavaScript
// Codex's exec tool runs, or the usual keys of a JSON argument object.
func codexSummary(input string) string {
	if m := execCmd.FindStringSubmatch(input); m != nil {
		var s string
		if json.Unmarshal([]byte(m[1]), &s) == nil {
			return firstLine(s)
		}
	}
	var args Object
	if json.Unmarshal([]byte(input), &args) == nil {
		for _, k := range []string{"cmd", "command", "path", "file_path", "query", "url"} {
			if s := Str(args[k]); s != "" {
				return firstLine(s)
			}
			if a := Arr(args[k]); len(a) > 0 {
				parts := make([]string, len(a))
				for i, x := range a {
					parts[i] = Str(x)
				}
				return firstLine(strings.Join(parts, " "))
			}
		}
	}
	return firstLine(input)
}

// joined is the text of a string or of an array of content blocks, one block per line.
func joined(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	var parts []string
	for _, b := range Arr(v) {
		if s := Str(Obj(b)["text"]); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, "\n")
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return clip(s, 200)
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + "…"
}

func stamp(v any) int64 {
	if t, e := time.Parse(time.RFC3339Nano, Str(v)); e == nil {
		return t.UnixMilli()
	}
	return 0
}
