package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type Object = map[string]any

func Str(v any) string { s, _ := v.(string); return s }
func Obj(v any) Object {
	m, _ := v.(map[string]any)
	if m == nil {
		return Object{}
	}
	return m
}
func Arr(v any) []any   { a, _ := v.([]any); return a }
func Num(v any) float64 { n, _ := v.(float64); return n }
func Bool(v any) bool   { b, _ := v.(bool); return b }
func Clone(v any) any   { b, _ := json.Marshal(v); var out any; _ = json.Unmarshal(b, &out); return out }
func Home() string      { h, _ := os.UserHomeDir(); return h }
func ConfigDir() string {
	if d := os.Getenv("ATC_CONFIG_DIR"); d != "" {
		a, _ := filepath.Abs(d)
		return a
	}
	d := os.Getenv("APPDATA")
	if d == "" {
		d = os.TempDir()
	}
	return filepath.Join(d, "Agent Terminal Control")
}
func Defaults() Object {
	return Object{
		"version":  1,
		"projects": Object{"claudeProjectsDir": nil, "pinned": []any{}, "names": Object{}, "sessionNames": Object{}},
		"ui":       Object{"sidebarWidth": 260, "sidebarOpen": true, "sessionsPerProject": 15, "zoom": 1.0, "notifications": true, "restoreTabs": true, "theme": "ATC Dark", "groupSubfolders": false, "groupByBranch": false, "sidebarView": "sessions"},
		"terminal": Object{"fontFamily": "\"FiraCode Nerd Font Mono\", \"Cascadia Mono\", Consolas, monospace", "fontSize": 13, "scrollback": 10000},
		"claude":   Object{"command": "claude", "resumeArgs": []any{"--resume", "{session}"}, "scratchDir": nil},
		"codex":    Object{"command": "codex", "resumeArgs": []any{"resume", "{session}"}, "homeDir": nil},
	}
}
func Merge(dst, src Object) {
	for k, v := range src {
		if _, ok := dst[k]; !ok {
			continue
		}
		if m, ok := v.(map[string]any); ok {
			if d, ok := dst[k].(map[string]any); ok {
				if k == "names" || k == "sessionNames" {
					dst[k] = m
				} else {
					Merge(d, m)
				}
				continue
			}
		}
		dst[k] = v
	}
}
func LoadSettings(path string) (Object, error) {
	s := Defaults()
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	parsed, e := ParseSettings(b)
	if e != nil {
		return s, e
	}
	return parsed, nil
}
func Save(path string, v any) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".atc-*.tmp")
	if e != nil {
		return e
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	// Windows readers and antivirus scanners can briefly deny replacement.
	// Retry sharing/access conflicts while retaining the original atomic rename.
	for attempt := 0; ; attempt++ {
		err := os.Rename(tmp, path)
		if err == nil {
			return nil
		}
		if attempt >= 20 || !(errors.Is(err, syscall.Errno(5)) || errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))) {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
}
func NormalizeTasks(v []any) []any {
	if v == nil {
		v = []any{}
	}
	for _, item := range v {
		t := Obj(item)
		for k, d := range (Object{"id": 0, "title": "", "state": "todo", "repo": nil, "branches": []any{}, "notes": "", "sessions": []any{}}) {
			if _, ok := t[k]; !ok {
				t[k] = d
			}
		}
		if s := Str(t["state"]); s != "doing" && s != "done" {
			t["state"] = "todo"
		}
	}
	return v
}
// MigrateSettings copies settings.json from a pre-rename config folder. A copy, never a
// move, and never over existing settings.
func MigrateSettings(legacy, current string) bool {
	target := filepath.Join(current, "settings.json")
	if _, e := os.Stat(target); !os.IsNotExist(e) {
		return false
	}
	b, e := os.ReadFile(filepath.Join(legacy, "settings.json"))
	if e != nil || os.MkdirAll(current, 0700) != nil {
		return false
	}
	return os.WriteFile(target, b, 0600) == nil
}

// ProjectionChanged reports whether a settings save changes which sessions the sidebar
// shows or where they are read from. Font, zoom and view changes must not rescan (#87).
func ProjectionChanged(prev, next Object, config string) bool {
	same := func(k string) bool { a, _ := json.Marshal(prev[k]); b, _ := json.Marshal(next[k]); return string(a) == string(b) }
	return !same("projects") || !same("codex") || Scratch(prev, config) != Scratch(next, config)
}
func LoadTasks(path string) ([]any, error) {
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return []any{}, nil
	}
	if e != nil {
		return nil, e
	}
	return ParseTasks(b)
}
func Roots(s Object) (string, string) {
	c := Str(Obj(s["projects"])["claudeProjectsDir"])
	if strings.TrimSpace(c) == "" {
		c = filepath.Join(Home(), ".claude", "projects")
	}
	x := Str(Obj(s["codex"])["homeDir"])
	if strings.TrimSpace(x) == "" {
		x = os.Getenv("CODEX_HOME")
	}
	if x == "" {
		x = filepath.Join(Home(), ".codex")
	}
	return c, x
}
func Scratch(s Object, config string) string {
	if p := Str(Obj(s["claude"])["scratchDir"]); strings.TrimSpace(p) != "" {
		return p
	}
	return filepath.Join(config, "scratch")
}
func Quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
func Argument(s string) string {
	if s == "" {
		return Quote(s)
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_-./\\:", r)) {
			return Quote(s)
		}
	}
	return s
}
// Codex always runs with --no-daemon: its background server often fails to start under ATC (#133).
func AgentCommand(s Object, provider, session string) string {
	cfg := Obj(s[provider])
	exe := Str(cfg["command"])
	if exe != "claude" && exe != "codex" {
		exe = "& " + Quote(exe)
	}
	parts := []string{exe}
	if provider == "codex" {
		parts = append(parts, "--no-daemon")
	}
	if session != "" {
		for _, a := range Arr(cfg["resumeArgs"]) {
			parts = append(parts, Argument(strings.ReplaceAll(Str(a), "{session}", session)))
		}
	}
	cmd := strings.Join(parts, " ")
	if provider == "codex" && strings.TrimSpace(Str(cfg["homeDir"])) != "" {
		_, h := Roots(s)
		cmd = "$env:CODEX_HOME = " + Quote(h) + "; " + cmd
	}
	return cmd
}
