/** Pure aggregation for the spend page. Rows arrive per UTC hour; days are local. */

import type { CostRow } from '../types';

export interface ProjectSpend {
  key: string;
  name: string;
  cost: number;
  tokens: number;
  partial?: boolean;
  unavailable?: boolean;
}

/** One model, or one session inside a project. */
export interface Spend {
  key: string;
  cost: number;
  tokens: number;
  partial?: boolean;
  unavailable?: boolean;
}

export interface SpendSummary {
  total: number;
  tokens: number;
  partial?: boolean;
  unavailable?: boolean;
  byProject: ProjectSpend[];
  byModel: Spend[];
  bySession: Spend[];
  /** Sessions of each project, by project key, most expensive first. */
  sessionsByProject: Map<string, Spend[]>;
  /** Days from the first recorded usage in the range, including gaps. */
  byDay: { day: string; cost: number; tokens: number }[];
  unpricedModels: string[];
}

/** `YYYY-MM-DD` in the viewer's timezone. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hourToLocalDay(hour: string): string {
  return localDay(new Date(`${hour}:00:00Z`));
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  // Capped so a mistyped year cannot build a million-row chart.
  while (d <= end && out.length < 3660) {
    out.push(localDay(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * The sidebar project a directory belongs to: itself, or the closest listed ancestor.
 * Claude started in `app\src-tauri` is still spend on `app`. Keys are the lowercase,
 * backslash-separated form from paths.rs.
 */
export function owningProject(key: string, projectKeys: string[]): string | null {
  let best: string | null = null;
  for (const k of projectKeys) {
    if ((key === k || key.startsWith(`${k}\\`)) && (!best || k.length > best.length)) best = k;
  }
  return best;
}

export function summarize(
  rows: CostRow[],
  from: string,
  to: string,
  /** Maps a row to the project it is reported under. Rows sharing a key are merged. */
  projectOf: (key: string, path: string | null) => { key: string; name: string },
): SpendSummary {
  const projects = new Map<string, ProjectSpend>();
  const models = new Map<string, Spend>();
  const allSessions = new Map<string, Spend>();
  const sessions = new Map<string, Map<string, Spend>>();
  const days = new Map<string, number>();
  const dayTokens = new Map<string, number>();
  const unpriced = new Set<string>();
  let total = 0;
  let tokens = 0;
  let partial = false;
  let priced = false;

  for (const r of rows) {
    const day = hourToLocalDay(r.hour);
    if (day < from || day > to) continue;
    const t = r.totalTokens;
    const cost = r.costUsd ?? 0;
    const unavailable = r.costUsd === null;
    const rowPartial = unavailable || r.unpriced;
    partial ||= rowPartial;
    priced ||= !unavailable;
    total += cost;
    tokens += t;
    days.set(day, (days.get(day) ?? 0) + cost);
    dayTokens.set(day, (dayTokens.get(day) ?? 0) + t);
    if (r.unpriced) unpriced.add(r.model);
    const owner = projectOf(r.projectKey, r.projectPath);
    let p = projects.get(owner.key);
    if (!p) {
      p = { ...owner, cost: 0, tokens: 0, ...(unavailable ? { unavailable: true } : {}), ...(rowPartial ? { partial: true } : {}) };
      projects.set(owner.key, p);
    }
    p.cost += cost;
    p.tokens += t;
    if (rowPartial) p.partial = true;
    if (!unavailable && p.unavailable) p.unavailable = false;
    add(models, `${r.provider}:${r.model}`, cost, t, rowPartial, unavailable);
    let inProject = sessions.get(owner.key);
    if (!inProject) {
      inProject = new Map();
      sessions.set(owner.key, inProject);
    }
    add(inProject, `${r.provider}:${r.sessionId}`, cost, t, rowPartial, unavailable);
    add(allSessions, `${r.provider}:${r.sessionId}`, cost, t, rowPartial, unavailable);
  }

  return {
    total,
    tokens,
    partial,
    unavailable: partial && !priced,
    byProject: [...projects.values()].sort((a, b) => b.cost - a.cost),
    byModel: dearestFirst(models),
    bySession: dearestFirst(allSessions),
    sessionsByProject: new Map([...sessions].map(([k, v]) => [k, dearestFirst(v)])),
    byDay: days.size ? daysBetween([...days.keys()].sort()[0], to).map((day) => ({ day, cost: days.get(day) ?? 0, tokens: dayTokens.get(day) ?? 0 })) : [],
    unpricedModels: [...unpriced].sort(),
  };
}

function add(into: Map<string, Spend>, key: string, cost: number, tokens: number, partial: boolean, unavailable: boolean) {
  const s = into.get(key) ?? { key, cost: 0, tokens: 0, ...(unavailable ? { unavailable: true } : {}), ...(partial ? { partial: true } : {}) };
  if (partial) s.partial = true;
  if (!unavailable && s.unavailable) s.unavailable = false;
  s.cost += cost;
  s.tokens += tokens;
  into.set(key, s);
}

function dearestFirst(m: Map<string, Spend>): Spend[] {
  return [...m.values()].sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}

/**
 * The rows behind the table, as CSV: one line per hour, project, model and session.
 * Quotes every field, because project names and paths can contain commas.
 */
export function toCsv(
  rows: CostRow[],
  from: string,
  to: string,
  projectOf: (key: string, path: string | null) => { key: string; name: string },
): string {
  const q = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const header = ['provider', 'day', 'hour_utc', 'project', 'path', 'model', 'session', 'input', 'output', 'cache_write', 'cache_read', 'reasoning', 'total_tokens', 'cost_usd'];
  const lines = [header.map(q).join(',')];
  for (const r of rows) {
    const day = hourToLocalDay(r.hour);
    if (day < from || day > to) continue;
    lines.push(
      [
        r.provider,
        day,
        r.hour,
        projectOf(r.projectKey, r.projectPath).name,
        r.projectPath ?? '',
        r.model,
        `${r.provider}:${r.sessionId}`,
        r.input,
        r.output,
        r.cacheWrite,
        r.cacheRead,
        r.reasoning,
        r.totalTokens,
        r.costUsd === null ? '' : r.costUsd.toFixed(6),
      ]
        .map(q)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function formatUsd(n: number): string {
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function monetary(s: { cost: number; partial?: boolean; unavailable?: boolean }): string {
  return s.unavailable ? 'Unavailable' : `${formatUsd(s.cost)}${s.partial ? ' (partial)' : ''}`;
}

export type Split = 'none' | 'model' | 'project';

export interface ChartData {
  /** Series names in stack order, largest first; "Other" last when there are more. */
  series: string[];
  /** One per day, or per local hour when the range is a single day. */
  buckets: { key: string; label: string; values: number[]; total: number }[];
}

/** Most series a chart stacks before folding the rest into "Other". */
export const MAX_SERIES = 5;

/**
 * Bars for the spend chart (#71): per day, or per hour for a single day, optionally split
 * by model or project, optionally as a running total. Daily bars start at the first day
 * with usage.
 */
export function chartData(
  rows: CostRow[],
  from: string,
  to: string,
  opts: { metric: 'cost' | 'tokens'; split: Split; cumulative: boolean },
  projectOf: (key: string, path: string | null) => { key: string; name: string },
): ChartData {
  const hourly = from === to;
  const cells = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const at = new Date(`${r.hour}:00:00Z`);
    const day = localDay(at);
    if (day < from || day > to) continue;
    const bucket = hourly ? String(at.getHours()).padStart(2, '0') : day;
    const name = opts.split === 'model' ? r.model : opts.split === 'project' ? projectOf(r.projectKey, r.projectPath).name : 'Total';
    const v = opts.metric === 'cost' ? (r.costUsd ?? 0) : r.totalTokens;
    const cell = cells.get(bucket) ?? new Map<string, number>();
    cell.set(name, (cell.get(name) ?? 0) + v);
    cells.set(bucket, cell);
    totals.set(name, (totals.get(name) ?? 0) + v);
  }

  const ranked = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const fold = ranked.length > MAX_SERIES;
  const kept = fold ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const series = fold ? [...kept, 'Other'] : kept;
  const slot = (name: string) => (kept.includes(name) ? kept.indexOf(name) : series.length - 1);

  let keys: string[];
  if (hourly) keys = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  else {
    const used = [...cells.keys()].filter((k) => [...cells.get(k)!.values()].some((v) => v > 0)).sort();
    keys = used.length ? daysBetween(used[0], to) : [];
  }

  const running = series.map(() => 0);
  const buckets = keys.map((key) => {
    const values = series.map(() => 0);
    for (const [name, v] of cells.get(key) ?? []) if (totals.get(name)! > 0) values[slot(name)] += v;
    if (opts.cumulative) values.forEach((v, i) => (values[i] = running[i] += v));
    return { key, label: hourly ? `${from} ${key}:00` : key, values, total: values.reduce((a, b) => a + b, 0) };
  });
  return { series, buckets };
}

export interface SessionStats {
  cost: number;
  tokens: number;
  partial: boolean;
  /** Share of input served from the prompt cache, 0..1. */
  cacheShare: number;
  /** First and last UTC hour with usage; transcripts carry no finer duration. */
  firstHour: string;
  lastHour: string;
  byModel: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }[];
}

/** All-time totals for one session, keyed `provider:sessionId`, like `/usage` (#80). */
export function sessionStats(rows: CostRow[], key: string): SessionStats | null {
  const mine = rows.filter((r) => `${r.provider}:${r.sessionId}` === key);
  if (!mine.length) return null;
  const models = new Map<string, SessionStats['byModel'][number]>();
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const r of mine) {
    const m = models.get(r.model) ?? { model: r.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    m.input += r.input;
    m.output += r.output;
    m.cacheRead += r.cacheRead;
    m.cacheWrite += r.cacheWrite;
    m.cost = m.cost === null || r.costUsd === null ? null : m.cost + r.costUsd;
    models.set(r.model, m);
    input += r.input;
    cacheRead += r.cacheRead;
    cacheWrite += r.cacheWrite;
  }
  const hours = mine.map((r) => r.hour).sort();
  const fed = input + cacheRead + cacheWrite;
  return {
    cost: mine.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    tokens: mine.reduce((a, r) => a + r.totalTokens, 0),
    partial: mine.some((r) => r.costUsd === null || r.unpriced),
    cacheShare: fed ? cacheRead / fed : 0,
    firstHour: hours[0],
    lastHour: hours[hours.length - 1],
    byModel: [...models.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
  };
}
