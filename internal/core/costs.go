package core

import (
	_ "embed"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed prices.json
var defaultPrices []byte

type usageFile struct {
	size, stamp, offset    int64
	records                []Object
	id, parent, cwd, model string
}
type Costs struct {
	mu    sync.Mutex
	files map[string]*usageFile
}
type tokens struct{ input, output, cached, write, reasoning, total int64 }

func readTokens(v Object) tokens {
	i, o := number(v["input_tokens"]), number(v["output_tokens"])
	t := i + o
	if _, ok := v["total_tokens"]; ok {
		t = number(v["total_tokens"])
	}
	return tokens{i, o, min(number(v["cached_input_tokens"]), i), min(number(v["cache_write_input_tokens"]), i), min(number(v["reasoning_output_tokens"]), o), t}
}
func (a tokens) sub(b tokens) tokens {
	return tokens{max(0, a.input-b.input), max(0, a.output-b.output), max(0, a.cached-b.cached), max(0, a.write-b.write), max(0, a.reasoning-b.reasoning), max(0, a.total-b.total)}
}
func (a tokens) add(b tokens) tokens {
	return tokens{a.input + b.input, a.output + b.output, a.cached + b.cached, a.write + b.write, a.reasoning + b.reasoning, a.total + b.total}
}
func newRow(provider, hour, id, cwd, model string) Object {
	key := ""
	if cwd != "" {
		cwd = Resolve(cwd)
		key = PathKey(cwd)
	}
	return Object{"provider": provider, "hour": hour, "sessionId": id, "projectKey": key, "projectPath": Nullable(cwd), "model": model, "input": int64(0), "output": int64(0), "cacheWrite": int64(0), "cacheRead": int64(0), "reasoning": int64(0), "totalTokens": int64(0), "costUsd": nil, "unpriced": false}
}
func prices(config string) Object {
	var p Object
	_ = json.Unmarshal(defaultPrices, &p)
	b, e := os.ReadFile(filepath.Join(config, "pricing.json"))
	if e == nil {
		var custom Object
		if json.Unmarshal(b, &custom) == nil {
			for _, provider := range []string{"claude", "codex"} {
				p[provider] = append(Arr(custom[provider]), Arr(p[provider])...)
			}
		}
	}
	return p
}
func priceFor(p Object, provider, model string) Object {
	model = strings.ToLower(model)
	for _, v := range Arr(p[provider]) {
		r := Obj(v)
		if provider == "claude" {
			pattern := strings.ToLower(Str(r["match"]))
			if pattern != "" && strings.Contains(model, pattern) {
				return r
			}
		} else {
			m := strings.ToLower(Str(r["model"]))
			if model == m {
				return r
			}
			if suffix, ok := strings.CutPrefix(model, m+"-"); ok {
				if _, e := time.Parse("2006-01-02", suffix); e == nil {
					return r
				}
			}
		}
	}
	return nil
}
func addNumber(m Object, k string, n int64) { m[k] = number(m[k]) + n }
func (c *Costs) Rows(settings Object, config string) []any {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.files == nil {
		c.files = map[string]*usageFile{}
	}
	claude, codex := Roots(settings)
	paths := map[string][]string{"claude": Files(claude, true), "codex": append(Files(filepath.Join(codex, "sessions"), true), Files(filepath.Join(codex, "archived_sessions"), true)...)}
	live := map[string]bool{}
	for provider, files := range paths {
		for _, path := range files {
			st, e := os.Stat(path)
			if e != nil {
				continue
			}
			live[path] = true
			f := c.files[path]
			if f == nil || st.Size() < f.size || st.Size() == f.size && st.ModTime().UnixNano() != f.stamp {
				f = &usageFile{id: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
				c.files[path] = f
			}
			if f.size == st.Size() && f.stamp == st.ModTime().UnixNano() {
				continue
			}
			consume := func(v Object) {
				if provider == "claude" {
					if v["type"] == "assistant" && Obj(v["message"])["usage"] != nil {
						m := Obj(v["message"])
						f.records = append(f.records, Object{"type": v["type"], "timestamp": v["timestamp"], "cwd": v["cwd"], "sessionId": v["sessionId"], "requestId": v["requestId"], "message": Object{"id": m["id"], "model": m["model"], "usage": m["usage"]}})
					}
					return
				}
				kind := Str(v["type"])
				p := v
				if a, ok := v["payload"]; ok {
					p = Obj(a)
				}
				if kind == "session_meta" || f.offset == 0 && Str(p["id"]) != "" && Str(p["timestamp"]) != "" && p["role"] == nil {
					f.id = Str(p["id"])
					f.cwd = Str(p["cwd"])
					f.parent = Str(p["parent_thread_id"])
					if f.parent == "" {
						f.parent = Str(Obj(Obj(Obj(p["source"])["subagent"])["thread_spawn"])["parent_thread_id"])
					}
					if f.parent == "" && Str(p["session_id"]) != f.id {
						f.parent = Str(p["session_id"])
					}
				}
				if kind == "turn_context" && Str(p["model"]) != "" {
					f.model = Str(p["model"])
				}
				usageKind := kind
				if kind == "event_msg" {
					usageKind = Str(p["type"])
				}
				if usageKind == "token_usage" || usageKind == "token_usage_record" || usageKind == "token_count" {
					r := Object{"timestamp": v["timestamp"], "payload": p, "kind": usageKind, "model": f.model}
					f.records = append(f.records, r)
				}
			}
			f.offset = ReadRecords(path, f.offset, consume)
			if provider == "claude" {
				if file, err := os.Open(path); err == nil {
					file.Seek(f.offset, 0)
					tail, _ := io.ReadAll(file)
					file.Close()
					var v Object
					if json.Unmarshal(tail, &v) == nil && v != nil {
						consume(v)
					}
				}
			}
			f.size = st.Size()
			f.stamp = st.ModTime().UnixNano()
		}
	}
	for p := range c.files {
		if !live[p] {
			delete(c.files, p)
		}
	}
	rates := prices(config)
	out := c.claudeRows(paths["claude"], rates)
	out = append(out, c.codexRows(paths["codex"], rates)...)
	return out
}
func (c *Costs) claudeRows(paths []string, rates Object) []any {
	dedup := map[string]Object{}
	for _, path := range paths {
		f := c.files[path]
		if f == nil {
			continue
		}
		for _, v := range f.records {
			m := Obj(v["message"])
			if m["model"] == "<synthetic>" {
				continue
			}
			stamp := Str(v["timestamp"])
			if len(stamp) < 13 {
				continue
			}
			id := Str(m["id"]) + ":" + Str(v["requestId"])
			if _, exists := dedup[id]; exists {
				continue
			}
			record := Obj(Clone(v))
			if Str(record["sessionId"]) == "" {
				record["sessionId"] = f.id
			}
			dedup[id] = record
		}
	}
	rows := map[string]Object{}
	for _, v := range dedup {
		m := Obj(v["message"])
		u := Obj(m["usage"])
		model := Str(m["model"])
		id := Str(v["sessionId"])
		hour := Str(v["timestamp"])[:13]
		cwd := Str(v["cwd"])
		k := hour + "\x00" + PathKey(cwd) + "\x00" + model + "\x00" + id
		r := rows[k]
		if r == nil {
			r = newRow("claude", hour, id, cwd, model)
			rows[k] = r
		}
		i, o, cr := number(u["input_tokens"]), number(u["output_tokens"]), number(u["cache_read_input_tokens"])
		w5, w1 := number(u["cache_creation_input_tokens"]), int64(0)
		if cc, ok := u["cache_creation"]; ok {
			w5 = number(Obj(cc)["ephemeral_5m_input_tokens"])
			w1 = number(Obj(cc)["ephemeral_1h_input_tokens"])
		}
		addNumber(r, "input", i)
		addNumber(r, "output", o)
		addNumber(r, "cacheRead", cr)
		addNumber(r, "cacheWrite", w5+w1)
		addNumber(r, "totalTokens", i+o+cr+w5+w1)
		if p := priceFor(rates, "claude", model); p != nil {
			cost := (float64(i)*Num(p["input"]) + float64(o)*Num(p["output"]) + float64(w5)*Num(p["input"])*1.25 + float64(w1)*Num(p["input"])*2 + float64(cr)*Num(p["input"])*0.1) / 1e6
			if u["speed"] == "fast" {
				cost *= 2
			}
			r["costUsd"] = Num(r["costUsd"]) + cost
		} else {
			r["unpriced"] = true
		}
	}
	return sortedRows(rows)
}

type record struct {
	stamp                         int64
	hour, thread, response, model string
	total, usage                  *tokens
	file                          *usageFile
}

func (c *Costs) codexRows(paths []string, rates Object) []any {
	owners := map[string]*usageFile{}
	parents := map[string]string{}
	records := []record{}
	for _, path := range paths {
		f := c.files[path]
		if f == nil {
			continue
		}
		if old := owners[f.id]; old == nil || f.stamp > old.stamp || f.stamp == old.stamp && f.size > old.size {
			owners[f.id] = f
		}
		if f.parent != "" {
			parents[f.id] = f.parent
		}
		for _, v := range f.records {
			p := Obj(v["payload"])
			t, e := time.Parse(time.RFC3339Nano, Str(v["timestamp"]))
			if e != nil {
				continue
			}
			r := record{stamp: t.UnixMilli(), hour: t.UTC().Format("2006-01-02T15"), thread: Str(p["thread_id"]), response: Str(p["response_id"]), model: Str(p["model"]), file: f}
			if r.thread == "" {
				r.thread = f.id
			}
			if r.model == "" {
				r.model = Str(v["model"])
			}
			if r.model == "" {
				r.model = "unknown"
			}
			if v["kind"] == "token_count" {
				if obj, ok := Obj(p["info"])["total_token_usage"].(map[string]any); ok {
					t := readTokens(obj)
					r.total = &t
				}
			} else {
				if obj, ok := p["thread_token_usage"].(map[string]any); ok {
					t := readTokens(obj)
					r.total = &t
				}
				if obj, ok := p["usage"].(map[string]any); ok {
					t := readTokens(obj)
					r.usage = &t
				}
			}
			if r.total != nil || r.usage != nil {
				records = append(records, r)
			}
		}
	}
	sort.SliceStable(records, func(i, j int) bool { return records[i].stamp < records[j].stamp })
	since := map[string]int64{}
	for _, r := range records {
		if r.response != "" && r.usage != nil {
			if _, ok := since[r.thread]; !ok {
				since[r.thread] = r.stamp
			}
		}
	}
	seen := map[string]bool{}
	snapshots := map[string]bool{}
	started := map[string]bool{}
	watermarks := map[string]tokens{}
	rows := map[string]Object{}
	for _, r := range records {
		if start, ok := since[r.thread]; r.response == "" && ok && r.stamp >= start {
			continue
		}
		if r.response != "" {
			k := r.thread + ":" + r.response
			if seen[k] {
				continue
			}
			seen[k] = true
		} else if r.total != nil {
			b, _ := json.Marshal([]any{r.thread, r.stamp, r.total.input, r.total.output, r.total.total})
			k := string(b)
			if snapshots[k] {
				continue
			}
			snapshots[k] = true
		}
		prev := watermarks[r.thread]
		var usage tokens
		if r.usage != nil {
			usage = *r.usage
			if !started[r.thread] && prev.total > 0 && r.total != nil && r.total.total >= prev.total {
				d := r.total.sub(prev)
				if d.total < usage.total {
					usage = d
				}
			}
			started[r.thread] = true
			if r.total != nil {
				watermarks[r.thread] = *r.total
			} else {
				watermarks[r.thread] = prev.add(*r.usage)
			}
		} else if r.total != nil {
			usage = *r.total
			if usage.total >= prev.total {
				usage = usage.sub(prev)
			}
			watermarks[r.thread] = *r.total
		}
		if usage.total == 0 {
			continue
		}
		owner := r.thread
		visited := map[string]bool{}
		for parents[owner] != "" && !visited[owner] {
			visited[owner] = true
			owner = parents[owner]
		}
		f := owners[owner]
		if f == nil {
			f = r.file
		}
		key := r.hour + "\x00" + owner + "\x00" + r.model
		row := rows[key]
		if row == nil {
			row = newRow("codex", r.hour, owner, f.cwd, r.model)
			rows[key] = row
		}
		addNumber(row, "input", max(0, usage.input-usage.cached-usage.write))
		addNumber(row, "output", usage.output)
		addNumber(row, "cacheRead", usage.cached)
		addNumber(row, "cacheWrite", usage.write)
		addNumber(row, "reasoning", usage.reasoning)
		addNumber(row, "totalTokens", usage.total)
	}
	for _, r := range rows {
		priceCodexRow(r, rates)
	}
	return sortedRows(rows)
}

// priceCodexRow sets costUsd, or flags the row unpriced for an unknown model. A known
// model without a cache-write rate is priced but still flagged as partially unpriced.
func priceCodexRow(r, rates Object) {
	p := priceFor(rates, "codex", Str(r["model"]))
	if p == nil {
		r["costUsd"], r["unpriced"] = nil, true
		return
	}
	r["costUsd"] = (float64(number(r["input"]))*Num(p["input"]) + float64(number(r["cacheRead"]))*Num(p["cached"]) + float64(number(r["cacheWrite"]))*Num(p["cacheWrite"]) + float64(number(r["output"]))*Num(p["output"])) / 1e6
	r["unpriced"] = number(r["cacheWrite"]) > 0 && p["cacheWrite"] == nil
}
func sortedRows(rows map[string]Object) []any {
	keys := make([]string, 0, len(rows))
	for k := range rows {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []any{}
	for _, k := range keys {
		out = append(out, rows[k])
	}
	return out
}
