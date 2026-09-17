/** Pure aggregation for the spend page. Rows arrive per UTC hour; days are local. */

import type { CostRow } from '../types';

export interface ProjectSpend {
  key: string;
  name: string;
  cost: number;
  tokens: number;
}

/** One model, or one session inside a project. */
export interface Spend {
  key: string;
  cost: number;
  tokens: number;
}

export interface SpendSummary {
  total: number;
  tokens: number;
  byProject: ProjectSpend[];
  byModel: Spend[];
  /** Sessions of each project, by project key, most expensive first. */
  sessionsByProject: Map<string, Spend[]>;
  /** Every day in the range, oldest first, including days with no spend. */
  byDay: { day: string; cost: number }[];
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
  const sessions = new Map<string, Map<string, Spend>>();
  const days = new Map<string, number>();
  const unpriced = new Set<string>();
  let total = 0;
  let tokens = 0;

  for (const r of rows) {
    const day = hourToLocalDay(r.hour);
    if (day < from || day > to) continue;
    const t = r.input + r.output + r.cacheWrite + r.cacheRead;
    total += r.costUsd;
    tokens += t;
    days.set(day, (days.get(day) ?? 0) + r.costUsd);
    if (r.unpriced) unpriced.add(r.model);
    const owner = projectOf(r.projectKey, r.projectPath);
    let p = projects.get(owner.key);
    if (!p) {
      p = { ...owner, cost: 0, tokens: 0 };
      projects.set(owner.key, p);
    }
    p.cost += r.costUsd;
    p.tokens += t;
    add(models, r.model, r.costUsd, t);
    let inProject = sessions.get(owner.key);
    if (!inProject) {
      inProject = new Map();
      sessions.set(owner.key, inProject);
    }
    add(inProject, r.sessionId, r.costUsd, t);
  }

  return {
    total,
    tokens,
    byProject: [...projects.values()].sort((a, b) => b.cost - a.cost),
    byModel: dearestFirst(models),
    sessionsByProject: new Map([...sessions].map(([k, v]) => [k, dearestFirst(v)])),
    byDay: daysBetween(from, to).map((day) => ({ day, cost: days.get(day) ?? 0 })),
    unpricedModels: [...unpriced].sort(),
  };
}

function add(into: Map<string, Spend>, key: string, cost: number, tokens: number) {
  const s = into.get(key) ?? { key, cost: 0, tokens: 0 };
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
  const header = ['day', 'hour_utc', 'project', 'path', 'model', 'session', 'input', 'output', 'cache_write', 'cache_read', 'cost_usd'];
  const lines = [header.map(q).join(',')];
  for (const r of rows) {
    const day = hourToLocalDay(r.hour);
    if (day < from || day > to) continue;
    lines.push(
      [
        day,
        r.hour,
        projectOf(r.projectKey, r.projectPath).name,
        r.projectPath ?? '',
        r.model,
        r.sessionId,
        r.input,
        r.output,
        r.cacheWrite,
        r.cacheRead,
        r.costUsd.toFixed(6),
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
