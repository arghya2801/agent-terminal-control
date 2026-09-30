package core

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

func ReadRecords(path string, offset int64, consume func(Object)) int64 {
	f, e := os.Open(path)
	if e != nil {
		return offset
	}
	defer f.Close()
	f.Seek(offset, 0)
	r := bufio.NewReader(f)
	for {
		line, e := r.ReadBytes('\n')
		if e != nil {
			return offset
		}
		offset += int64(len(line))
		var v Object
		if json.Unmarshal(line, &v) == nil && v != nil {
			consume(v)
		}
	}
}
func Text(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	var texts []string
	for _, b := range Arr(v) {
		m := Obj(b)
		if t := Str(m["text"]); t != "" {
			texts = append(texts, t)
		}
	}
	return strings.TrimSpace(strings.Join(texts, " "))
}
func Tidy(s string, ellipsis bool) string {
	r := []rune(strings.Join(strings.Fields(s), " "))
	if len(r) > 72 {
		if ellipsis {
			return strings.TrimSpace(string(r[:71])) + "…"
		}
		return string(r[:72])
	}
	return string(r)
}
func Nullable(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
func PathKey(path string) string {
	p := strings.ReplaceAll(path, "/", "\\")
	p = strings.TrimPrefix(p, `\\?\`)
	return strings.ToLower(strings.TrimRight(p, `\`))
}
func Resolve(path string) string {
	if p, e := filepath.EvalSymlinks(path); e == nil {
		path = p
	}
	return strings.TrimPrefix(filepath.Clean(path), `\\?\`)
}
func IsDir(path string) bool { s, e := os.Stat(path); return e == nil && s.IsDir() }
func Files(root string, recursive bool) []string {
	out := []string{}
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		p := filepath.Join(root, e.Name())
		if e.IsDir() && recursive {
			out = append(out, Files(p, true)...)
		} else if !e.IsDir() && e.Type().IsRegular() && filepath.Ext(p) == ".jsonl" {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}
func ClaudeFiles(root string) []string {
	out := []string{}
	dirs, _ := os.ReadDir(root)
	for _, d := range dirs {
		if d.IsDir() {
			out = append(out, Files(filepath.Join(root, d.Name()), false)...)
		}
	}
	sort.Strings(out)
	return out
}
func baseSession(path, provider, id string, st os.FileInfo) Object {
	return Object{"provider": provider, "id": id, "file": path, "cwd": nil, "gitBranch": nil, "label": id, "labelSource": "uuid", "mtimeMs": st.ModTime().UnixMilli(), "size": st.Size(), "createdAtMs": nil, "activity": nil, "activitySequence": 0}
}
func ClaudeSession(path string, st os.FileInfo) Object {
	id := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	s := baseSession(path, "claude", id, st)
	h := Object{}
	f, e := os.Open(path)
	if e != nil {
		return s
	}
	defer f.Close()
	scan := bufio.NewScanner(io.LimitReader(f, 512*1024))
	scan.Buffer(make([]byte, 64*1024), 512*1024+1)
	for n := 0; n < 300 && scan.Scan(); n++ {
		var v Object
		if json.Unmarshal(scan.Bytes(), &v) != nil {
			continue
		}
		kind := Str(v["type"])
		if kind == "agent-name" {
			if Str(h["agentName"]) == "" {
				h["agentName"] = v["agentName"]
			}
		} else if kind == "ai-title" {
			if Str(h["aiTitle"]) == "" {
				h["aiTitle"] = v["aiTitle"]
			}
		} else {
			for _, k := range []string{"cwd", "gitBranch", "slug"} {
				if Str(h[k]) == "" {
					h[k] = Nullable(strings.TrimSpace(Str(v[k])))
				}
			}
			if kind == "user" && Str(h["firstMessage"]) == "" && !Bool(v["isMeta"]) && !Bool(v["isSidechain"]) {
				txt := Text(Obj(v["message"])["content"])
				origin := Str(Obj(v["origin"])["kind"])
				human := origin == "human"
				if origin == "" {
					human = true
					for _, m := range []string{"<local-command-caveat>", "<command-name>", "<local-command-stdout>", "<system-reminder>"} {
						if strings.Contains(txt, m) {
							human = false
						}
					}
				}
				if human {
					h["firstMessage"] = txt
				}
			}
			if Str(h["cwd"]) != "" && Str(h["aiTitle"]) != "" {
				break
			}
		}
	}
	if n := tailAgentName(f, st.Size()); n != "" {
		h["agentName"] = n
	}
	s["cwd"] = Nullable(Str(h["cwd"]))
	s["gitBranch"] = Nullable(Str(h["gitBranch"]))
	r := []rune(id)
	if len(r) > 8 {
		r = r[:8]
	}
	s["label"] = string(r)
	for _, k := range []string{"agentName", "aiTitle", "slug", "firstMessage"} {
		label := Tidy(Str(h[k]), true)
		if len([]rune(label)) >= 3 {
			s["label"] = label
			s["labelSource"] = k
			break
		}
	}
	return s
}

// tailAgentName is the latest `agent-name` in the last 64KB. Claude renames a session as
// it goes and writes the new name near the end, far past the head budget.
func tailAgentName(f *os.File, size int64) string {
	start := size - 64*1024
	if start < 0 {
		start = 0
	}
	f.Seek(start, 0)
	tail, _ := io.ReadAll(io.LimitReader(f, 64*1024))
	lines := strings.Split(string(tail), "\n")
	if start > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if !strings.Contains(lines[i], `"agent-name"`) {
			continue
		}
		var v Object
		if json.Unmarshal([]byte(lines[i]), &v) == nil && Str(v["type"]) == "agent-name" && strings.TrimSpace(Str(v["agentName"])) != "" {
			return Str(v["agentName"])
		}
	}
	return ""
}

type codexReader struct {
	Offset          int64
	Meta            Object
	Child, Archived bool
}

func (r *codexReader) update(path string, st os.FileInfo) {
	r.Offset = ReadRecords(path, r.Offset, func(v Object) {
		kind := Str(v["type"])
		p := v
		if x, ok := v["payload"]; ok {
			p = Obj(x)
		}
		if kind == "session_meta" || r.Meta == nil && Str(p["id"]) != "" && p["timestamp"] != nil && p["role"] == nil {
			id := Str(p["id"])
			if id == "" {
				return
			}
			_, sub := Obj(p["source"])["subagent"]
			r.Child = sub || strings.HasPrefix(Str(p["source"]), "subagent") || Str(p["parent_thread_id"]) != ""
			r.Archived = Bool(p["archived"])
			r.Meta = baseSession(path, "codex", id, st)
			r.Meta["cwd"] = Nullable(Str(p["cwd"]))
			branch := Str(Obj(p["git"])["branch"])
			if branch == "" {
				branch = Str(p["git_branch"])
			}
			r.Meta["gitBranch"] = Nullable(branch)
			stamp := Str(p["timestamp"])
			if stamp == "" {
				stamp = Str(v["timestamp"])
			}
			if t, e := time.Parse(time.RFC3339Nano, stamp); e == nil {
				r.Meta["createdAtMs"] = t.UnixMilli()
			}
			return
		}
		s := r.Meta
		if s == nil {
			return
		}
		if kind == "event_msg" {
			a := ""
			switch Str(p["type"]) {
			case "task_started", "turn_started":
				a = "working"
			case "task_complete", "turn_complete", "turn_completed":
				a = "idle"
			case "turn_aborted", "task_interrupted", "turn_interrupted":
				a = "interrupted"
			}
			if a != "" && s["activity"] != a {
				s["activity"] = a
				s["activitySequence"] = number(s["activitySequence"]) + 1
			}
		}
		if s["labelSource"] == "uuid" {
			txt := ""
			if kind == "event_msg" && p["type"] == "user_message" {
				txt = Str(p["message"])
			} else if (kind == "response_item" || kind == "message") && p["role"] == "user" {
				txt = Text(p["content"])
			}
			txt = strings.TrimSpace(txt)
			for _, prefix := range []string{"# AGENTS.md instructions", "<environment_context>", "<permissions instructions>", "<instructions>", "<system-reminder>", "<developer_instructions>"} {
				if strings.HasPrefix(txt, prefix) {
					txt = ""
				}
			}
			if txt != "" {
				s["label"] = Tidy(txt, false)
				s["labelSource"] = "firstMessage"
			}
		}
	})
	if r.Meta != nil {
		r.Meta["mtimeMs"] = st.ModTime().UnixMilli()
		r.Meta["size"] = st.Size()
	}
}
func number(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}

type cachedSession struct {
	Size, Stamp int64
	Meta        Object
	Codex       *codexReader
}
type Index struct {
	mu        sync.Mutex
	cache     map[string]*cachedSession
	CachePath string
	Hits      int // transcripts answered from the cache since it was (re)loaded
}

// ProjectionKey identifies what the sidebar renders. Timestamps are left out: the watcher
// fires continuously while a session is written, and re-rendering on each write is waste.
func ProjectionKey(snap Object) string {
	projection := Obj(Clone(snap))
	for _, p := range Arr(projection["projects"]) {
		delete(Obj(p), "lastActiveMs")
		for _, s := range Arr(Obj(p)["sessions"]) {
			delete(Obj(s), "mtimeMs")
			delete(Obj(s), "size")
		}
	}
	b, _ := json.Marshal(projection)
	return string(b)
}

func (idx *Index) Scan(settings Object, force bool) Object {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.cache == nil && !force && idx.CachePath != "" {
		if b, e := os.ReadFile(idx.CachePath); e == nil {
			var disk struct {
				Version int
				Files   map[string]*cachedSession
			}
			if json.Unmarshal(b, &disk) == nil && disk.Version == 1 && disk.Files != nil {
				idx.cache = disk.Files
			}
		}
	}
	if idx.cache == nil || force {
		idx.cache = map[string]*cachedSession{}
		idx.Hits = 0
	}
	dirty := force
	c, x := Roots(settings)
	names := map[string]string{}
	ReadRecords(filepath.Join(x, "session_index.jsonl"), 0, func(v Object) {
		n := Str(v["thread_name"])
		if n == "" {
			n = Str(v["name"])
		}
		if strings.TrimSpace(n) != "" {
			names[Str(v["id"])] = strings.TrimSpace(n)
		}
	})
	sessions := []Object{}
	seen := map[string]bool{}
	for provider, files := range map[string][]string{"claude": ClaudeFiles(c), "codex": Files(filepath.Join(x, "sessions"), true)} {
		for _, path := range files {
			st, e := os.Stat(path)
			if e != nil {
				continue
			}
			seen[path] = true
			size, stamp := st.Size(), st.ModTime().UnixNano()
			entry := idx.cache[path]
			switch {
			case entry != nil && entry.Size == size && entry.Stamp == stamp:
				idx.Hits++
			case provider == "claude" && entry != nil && entry.Meta != nil && size > entry.Size && entry.Meta["labelSource"] != "uuid":
				// Claude only appends to a live transcript, so its head is unchanged: refresh
				// recency and a rename near the end instead of re-reading 512KB per write.
				idx.Hits++
				entry.Meta["mtimeMs"], entry.Meta["size"] = st.ModTime().UnixMilli(), size
				if f, e := os.Open(path); e == nil {
					if n := Tidy(tailAgentName(f, size), true); len([]rune(n)) >= 3 {
						entry.Meta["label"], entry.Meta["labelSource"] = n, "agentName"
					}
					f.Close()
				}
				entry.Size, entry.Stamp = size, stamp
				dirty = true
			default:
				// New, shrunk, rewritten in place, or (Claude) a head that never yielded a label.
				// A grown Codex file keeps its reader and resumes from the last offset.
				if entry == nil || size <= entry.Size || provider == "claude" {
					entry = &cachedSession{}
					idx.cache[path] = entry
				}
				if provider == "claude" {
					entry.Meta = ClaudeSession(path, st)
				} else {
					if entry.Codex == nil {
						entry.Codex = &codexReader{}
					}
					entry.Codex.update(path, st)
					entry.Meta = entry.Codex.Meta
				}
				dirty = true
				entry.Size, entry.Stamp = size, stamp
			}
			if entry.Meta == nil || entry.Codex != nil && (entry.Codex.Child || entry.Codex.Archived) {
				continue
			}
			s := Obj(Clone(entry.Meta))
			if n := names[Str(s["id"])]; provider == "codex" && n != "" {
				s["label"] = n
				s["labelSource"] = "agentName"
			}
			sessions = append(sessions, s)
		}
	}
	for p := range idx.cache {
		if !seen[p] {
			delete(idx.cache, p)
			dirty = true
		}
	}
	if dirty && idx.CachePath != "" {
		_ = Save(idx.CachePath, struct {
			Version int
			Files   map[string]*cachedSession
		}{1, idx.cache})
	}
	sort.SliceStable(sessions, func(i, j int) bool { return number(sessions[i]["mtimeMs"]) > number(sessions[j]["mtimeMs"]) })
	unique := []Object{}
	ids := map[string]bool{}
	for _, s := range sessions {
		k := Str(s["provider"]) + ":" + Str(s["id"])
		if !ids[k] {
			ids[k] = true
			unique = append(unique, s)
		}
	}
	return BuildProjects(unique, settings)
}
func BuildProjects(sessions []Object, settings Object) Object {
	projects := map[string]Object{}
	order := map[string]int64{}
	add := func(path string) Object {
		k := "\x00unknown"
		name := "Unknown"
		var p any
		if path != "" {
			path = Resolve(path)
			k = PathKey(path)
			name = filepath.Base(path)
			p = path
		}
		if projects[k] == nil {
			projects[k] = Object{"key": k, "path": p, "name": name, "pinned": false, "exists": path != "" && IsDir(path), "lastActiveMs": int64(0), "sessions": []any{}}
		}
		return projects[k]
	}
	cfg := Obj(settings["projects"])
	renames := Obj(cfg["sessionNames"])
	for _, s := range sessions {
		p := add(Str(s["cwd"]))
		id := Str(s["id"])
		n := Str(renames[Str(s["provider"])+":"+id])
		if n == "" && s["provider"] == "claude" {
			n = Str(renames[id])
		}
		if strings.TrimSpace(n) != "" {
			s["label"] = strings.TrimSpace(n)
			s["labelSource"] = "custom"
		}
		p["sessions"] = append(Arr(p["sessions"]), s)
		if number(s["mtimeMs"]) > number(p["lastActiveMs"]) {
			p["lastActiveMs"] = s["mtimeMs"]
		}
	}
	for _, v := range Arr(cfg["pinned"]) {
		pin := Obj(v)
		path := Str(pin["path"])
		if strings.TrimSpace(path) == "" {
			continue
		}
		p := add(path)
		p["pinned"] = true
		if n := strings.TrimSpace(Str(pin["displayName"])); n != "" {
			p["name"] = n
		}
		order[Str(p["key"])] = number(pin["order"])
	}
	// Shown in the sidebar's Scratch view instead of among the projects.
	if p := projects[PathKey(Resolve(Scratch(settings, ConfigDir())))]; p != nil {
		p["name"], p["kind"] = "Scratch", "scratch"
	}
	if p := projects[PathKey(Resolve(Chats(ConfigDir())))]; p != nil {
		p["name"], p["kind"] = "Chats", "chats"
	}
	for path, n := range Obj(cfg["names"]) {
		if p := projects[PathKey(Resolve(path))]; p != nil && strings.TrimSpace(Str(n)) != "" {
			p["name"] = strings.TrimSpace(Str(n))
		}
	}
	out := []any{}
	for _, p := range projects {
		a := Arr(p["sessions"])
		sort.SliceStable(a, func(i, j int) bool { return number(Obj(a[i])["mtimeMs"]) > number(Obj(a[j])["mtimeMs"]) })
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := Obj(out[i]), Obj(out[j])
		ap, bp := Bool(a["pinned"]), Bool(b["pinned"])
		if ap != bp {
			return ap
		}
		ak, bk := Str(a["key"]), Str(b["key"])
		if ap && order[ak] != order[bk] {
			return order[ak] < order[bk]
		}
		if (ak == "\x00unknown") != (bk == "\x00unknown") {
			return bk == "\x00unknown"
		}
		if number(a["lastActiveMs"]) != number(b["lastActiveMs"]) {
			return number(a["lastActiveMs"]) > number(b["lastActiveMs"])
		}
		return strings.ToLower(Str(a["name"])) < strings.ToLower(Str(b["name"]))
	})
	return Object{"projects": out, "sessionCount": len(sessions)}
}
