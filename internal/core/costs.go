package core

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed prices.json
var defaultPrices []byte

type usageFile struct {
	size, stamp, offset    int64
	claude                 []claudeUsage
	codex                  []record
	meta                   bool
	id, parent, cwd, model string
}

// claudeUsage is the part of an assistant line that costs and context read.
type claudeUsage struct {
	hour, cwd, session, key, model                      string
	input, output, cacheRead, created, write5m, write1h int64
	fast                                                bool
}
type Costs struct {
	mu    sync.Mutex
	files map[string]*usageFile
	// Every row last written to usage-history.json, and a hash of its bytes.
	ledger []Object
	sum    [32]byte
	// The price table and the price files' sizes and times it was read at.
	priceKey string
	rates    Object
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
func newRow(provider, hour, id, cwd, model string, cwds map[string]string) Object {
	key := ""
	if cwd != "" {
		r, ok := cwds[cwd]
		if !ok {
			r = Resolve(cwd)
			cwds[cwd] = r
		}
		cwd = r
		key = PathKey(cwd)
	}
	return Object{"provider": provider, "hour": hour, "sessionId": id, "projectKey": key, "projectPath": Nullable(cwd), "model": model, "input": int64(0), "output": int64(0), "cacheWrite": int64(0), "cacheRead": int64(0), "reasoning": int64(0), "totalTokens": int64(0), "costUsd": nil, "unpriced": false}
}

const pricesURL = "https://raw.githubusercontent.com/arghya2801/agent-terminal-control/main/internal/core/prices.json"

// RefreshPrices caches the table from main, so a new model needs a commit, not a release.
// ponytail: fetched once per launch, add a timer if the app stays open for weeks.
func RefreshPrices(config string) {
	c := http.Client{Timeout: 15 * time.Second}
	res, e := c.Get(pricesURL)
	if e != nil {
		return
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var p Object
	if e != nil || res.StatusCode != http.StatusOK || json.Unmarshal(b, &p) != nil || len(Arr(p["codex"])) == 0 || len(Arr(p["claude"])) == 0 {
		return
	}
	_ = WriteFile(filepath.Join(config, "prices-latest.json"), b)
}
func prices(config string) Object {
	var p Object
	if b, e := os.ReadFile(filepath.Join(config, "prices-latest.json")); e != nil || json.Unmarshal(b, &p) != nil {
		p = nil
		_ = json.Unmarshal(defaultPrices, &p)
	}
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

const litellmURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"

// RefreshLitellm caches LiteLLM's OpenAI and Anthropic prices, so a new model prices the day LiteLLM lists it.
func RefreshLitellm(config string) {
	c := http.Client{Timeout: 30 * time.Second}
	res, e := c.Get(litellmURL)
	if e != nil {
		return
	}
	defer res.Body.Close()
	var all map[string]Object
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&all) != nil {
		return
	}
	keep := Object{}
	for id, m := range all {
		if provider := Str(m["litellm_provider"]); provider == "openai" || provider == "anthropic" {
			row := Object{"litellm_provider": provider}
			for _, k := range []string{"input_cost_per_token", "output_cost_per_token", "cache_read_input_token_cost", "cache_creation_input_token_cost", "max_input_tokens"} {
				if v, ok := m[k]; ok {
					row[k] = v
				}
			}
			keep[id] = row
		}
	}
	if len(keep) > 0 {
		_ = Save(filepath.Join(config, "prices-litellm.json"), keep)
	}
}

// pricesWith adds the cached LiteLLM table when prices.litellm is on.
func pricesWith(settings Object, config string) Object {
	p := prices(config)
	if on, _ := Obj(settings["prices"])["litellm"].(bool); on {
		var l Object
		if b, e := os.ReadFile(filepath.Join(config, "prices-litellm.json")); e == nil && json.Unmarshal(b, &l) == nil {
			p["litellm"] = l
		}
	}
	return p
}

// pricesCached is pricesWith, read again only when a price file or the setting changes.
func (c *Costs) pricesCached(settings Object, config string) Object {
	on, _ := Obj(settings["prices"])["litellm"].(bool)
	key := fmt.Sprint(config, on)
	for _, n := range []string{"prices-latest.json", "pricing.json", "prices-litellm.json"} {
		if st, e := os.Stat(filepath.Join(config, n)); e == nil {
			key += fmt.Sprint("|", st.Size(), st.ModTime().UnixNano())
		} else {
			key += "|-"
		}
	}
	if key != c.priceKey || c.rates == nil {
		c.priceKey, c.rates = key, pricesWith(settings, config)
	}
	return c.rates
}

var modelDate = regexp.MustCompile(`-\d{8}$`)

func normalizeModel(model string) string {
	return modelDate.ReplaceAllString(strings.TrimSuffix(strings.ToLower(model), "[1m]"), "")
}

// litellmRow converts LiteLLM's USD per token to a row in USD per million tokens.
func litellmRow(m Object, provider string) Object {
	if m["input_cost_per_token"] == nil || m["output_cost_per_token"] == nil {
		return nil
	}
	r := Object{"input": Num(m["input_cost_per_token"]) * 1e6, "output": Num(m["output_cost_per_token"]) * 1e6}
	set := func(k, from string) {
		if m[from] != nil {
			r[k] = Num(m[from]) * 1e6
		}
	}
	if provider == "claude" {
		set("cacheRead", "cache_read_input_token_cost")
		if m["max_input_tokens"] != nil {
			r["context"] = number(m["max_input_tokens"])
		}
	} else {
		set("cached", "cache_read_input_token_cost")
	}
	set("cacheWrite", "cache_creation_input_token_cost")
	return r
}

// priceFor looks up our exact row, then LiteLLM's exact key, then our family rows.
func priceFor(p Object, provider, model string) Object {
	model = normalizeModel(model)
	for _, v := range Arr(p[provider]) {
		r := Obj(v)
		if provider == "claude" && strings.TrimPrefix(model, "claude-") == strings.ToLower(Str(r["match"])) || provider == "codex" && model == strings.ToLower(Str(r["model"])) {
			return r
		}
	}
	// ponytail: ignores LiteLLM's above-272K tier, so a long-context Astra request prices low.
	if r := litellmRow(Obj(Obj(p["litellm"])[model]), provider); r != nil {
		return r
	}
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

// InputPrices is each priced Claude model's input price in USD per million tokens.
func InputPrices(settings Object, config string, models []string) Object {
	rates := pricesWith(settings, config)
	out := Object{}
	for _, m := range models {
		if p := priceFor(rates, "claude", m); p != nil {
			out[m] = Num(p["input"])
		}
	}
	return out
}
func addNumber(m Object, k string, n int64) { m[k] = number(m[k]) + n }
func (c *Costs) Rows(settings Object, config string) []any {
	c.mu.Lock()
	defer c.mu.Unlock()
	paths := c.scan(settings)
	rates := c.pricesCached(settings, config)
	out := c.claudeRows(paths["claude"], rates)
	out = append(out, c.codexRows(paths["codex"], rates)...)
	return c.remember(config, out)
}

// Context is how full each session's context window was on its latest request, keyed
// `provider:sessionId`: the tokens sent and the model's window.
func (c *Costs) Context(settings Object, config string) Object {
	c.mu.Lock()
	defer c.mu.Unlock()
	paths := c.scan(settings)
	rates := c.pricesCached(settings, config)
	priced := map[string]Object{}
	out := Object{}
	for _, path := range paths["claude"] {
		f := c.files[path]
		// Subagent transcripts carry the parent's sessionId; their context is their own.
		if f == nil || len(f.claude) == 0 || filepath.Base(filepath.Dir(path)) == "subagents" {
			continue
		}
		last, first := f.claude[len(f.claude)-1], f.claude[0]
		used := last.input + last.cacheRead + last.created
		window := int64(200_000)
		p, ok := priced[last.model]
		if !ok {
			p = priceFor(rates, "claude", last.model)
			priced[last.model] = p
		}
		if p != nil && number(p["context"]) > 0 {
			window = number(p["context"])
		}
		// ponytail: a model with an unlisted 1M window shows as over 200K; list it in prices.json.
		if used > window {
			window = 1_000_000
		}
		out["claude:"+f.id] = Object{"used": used, "window": window, "first": first.input + first.cacheRead + first.created}
	}
	for _, path := range paths["codex"] {
		f := c.files[path]
		if f == nil {
			continue
		}
		for i := len(f.codex) - 1; i >= 0; i-- {
			if r := f.codex[i]; r.window > 0 {
				out["codex:"+f.id] = Object{"used": r.lastInput, "window": r.window}
				break
			}
		}
	}
	return out
}

// scan brings every transcript's usage records up to date and returns the paths by provider.
func (c *Costs) scan(settings Object) map[string][]string {
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
						u := Obj(m["usage"])
						r := claudeUsage{cwd: Str(v["cwd"]), session: Str(v["sessionId"]), key: Str(m["id"]) + ":" + Str(v["requestId"]), model: Str(m["model"]),
							input: number(u["input_tokens"]), output: number(u["output_tokens"]), cacheRead: number(u["cache_read_input_tokens"]), created: number(u["cache_creation_input_tokens"]), fast: u["speed"] == "fast"}
						if s := Str(v["timestamp"]); len(s) >= 13 {
							r.hour = s[:13]
						}
						if r.session == "" {
							r.session = f.id
						}
						r.write5m = r.created
						if cc, ok := u["cache_creation"]; ok {
							r.write5m, r.write1h = number(Obj(cc)["ephemeral_5m_input_tokens"]), number(Obj(cc)["ephemeral_1h_input_tokens"])
						}
						f.claude = append(f.claude, r)
					}
					return
				}
				kind := Str(v["type"])
				p := v
				if a, ok := v["payload"]; ok {
					p = Obj(a)
				}
				if kind == "session_meta" || f.offset == 0 && !f.meta && Str(p["id"]) != "" && Str(p["timestamp"]) != "" && p["role"] == nil {
					f.meta = true
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
					r := record{thread: Str(p["thread_id"]), response: Str(p["response_id"]), model: Str(p["model"]), file: f}
					if r.model == "" {
						r.model = f.model
					}
					if r.model == "" {
						r.model = "unknown"
					}
					if t, e := time.Parse(time.RFC3339Nano, Str(v["timestamp"])); e == nil {
						r.stamp, r.hour = t.UnixMilli(), t.UTC().Format("2006-01-02T15")
					}
					info := Obj(p["info"])
					if usageKind == "token_count" {
						if obj, ok := info["total_token_usage"].(map[string]any); ok {
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
					r.window, r.lastInput = number(info["model_context_window"]), number(Obj(info["last_token_usage"])["input_tokens"])
					if r.total != nil || r.usage != nil || r.window > 0 {
						f.codex = append(f.codex, r)
					}
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
						f.offset += int64(len(tail))
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
	return paths
}

// remember keeps rows for sessions whose transcripts are gone. Claude Code deletes
// transcripts after 30 days by default, which used to drop those days from the history.
// ponytail: rewrites the whole ledger when anything changes; split it by month if it grows large.
func (c *Costs) remember(config string, fresh []any) []any {
	path := filepath.Join(config, "usage-history.json")
	if c.ledger == nil {
		b, _ := os.ReadFile(path)
		_ = json.Unmarshal(b, &c.ledger)
	}
	live := map[string]bool{}
	for _, r := range fresh {
		live[Str(Obj(r)["provider"])+":"+Str(Obj(r)["sessionId"])] = true
	}
	for _, r := range c.ledger {
		if !live[Str(r["provider"])+":"+Str(r["sessionId"])] {
			fresh = append(fresh, r)
		}
	}
	if b, e := json.Marshal(fresh); e == nil && sha256.Sum256(b) != c.sum {
		c.sum = sha256.Sum256(b)
		_ = WriteFile(path, b)
		c.ledger = make([]Object, len(fresh))
		for i, r := range fresh {
			c.ledger[i] = Obj(r)
		}
	}
	return fresh
}
func (c *Costs) claudeRows(paths []string, rates Object) []any {
	seen := map[string]bool{}
	priced := map[string]Object{}
	cwds := map[string]string{}
	rows := map[string]Object{}
	for _, path := range paths {
		f := c.files[path]
		if f == nil {
			continue
		}
		for _, u := range f.claude {
			if u.model == "<synthetic>" || u.hour == "" || seen[u.key] {
				continue
			}
			seen[u.key] = true
			k := u.hour + "\x00" + PathKey(u.cwd) + "\x00" + u.model + "\x00" + u.session
			r := rows[k]
			if r == nil {
				r = newRow("claude", u.hour, u.session, u.cwd, u.model, cwds)
				rows[k] = r
			}
			i, o, cr, w5, w1 := u.input, u.output, u.cacheRead, u.write5m, u.write1h
			addNumber(r, "input", i)
			addNumber(r, "output", o)
			addNumber(r, "cacheRead", cr)
			addNumber(r, "cacheWrite", w5+w1)
			addNumber(r, "totalTokens", i+o+cr+w5+w1)
			p, ok := priced[u.model]
			if !ok {
				p = priceFor(rates, "claude", u.model)
				priced[u.model] = p
			}
			if p != nil {
				cacheRead := Num(p["input"]) * 0.1
				if _, ok := p["cacheRead"]; ok {
					cacheRead = Num(p["cacheRead"])
				}
				cost := (float64(i)*Num(p["input"]) + float64(o)*Num(p["output"]) + float64(w5)*Num(p["input"])*1.25 + float64(w1)*Num(p["input"])*2 + float64(cr)*cacheRead) / 1e6
				if u.fast {
					cost *= 2
				}
				r["costUsd"] = Num(r["costUsd"]) + cost
			} else {
				r["unpriced"] = true
			}
		}
	}
	return sortedRows(rows)
}

type record struct {
	stamp                         int64
	hour, thread, response, model string
	total, usage                  *tokens
	window, lastInput             int64
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
		for _, r := range f.codex {
			if r.hour == "" || r.total == nil && r.usage == nil {
				continue
			}
			if r.thread == "" {
				r.thread = f.id
			}
			records = append(records, r)
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
	cwds := map[string]string{}
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
			row = newRow("codex", r.hour, owner, f.cwd, r.model, cwds)
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
