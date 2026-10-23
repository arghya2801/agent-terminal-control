/**
 * Reads the plan usage response (`/api/oauth/usage`) into what the page draws.
 *
 * The response isn't a public API. It carries internal codename fields next to the real
 * windows, so this reads only the fields `/usage` itself shows, and ignores the rest.
 */

export interface PlanLimit {
  key: string;
  label: string;
  percent: number;
  resetsAt: string | null;
  windowMinutes?: number;
}

const KIND_LABELS: Record<string, string> = {
  session: 'Current session',
  weekly_all: 'Current week (all models)',
  weekly_opus: 'Current week (Opus)',
  weekly_sonnet: 'Current week (Sonnet)',
};

/** Older responses have no `limits` array, only these windows. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Current week (all models)',
  seven_day_opus: 'Current week (Opus)',
  seven_day_sonnet: 'Current week (Sonnet)',
};

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * The one limit the usage chip shows: Claude's 5-hour session, else Claude's tightest
 * should the session window ever go missing, else Codex's tightest.
 */
export function chipLimit(claude: PlanLimit[], codex: PlanLimit[]): PlanLimit | undefined {
  const session = claude.find((l) => l.key.startsWith('session:') || l.key === 'five_hour');
  return session ?? [...(claude.length ? claude : codex)].sort((a, b) => b.percent - a.percent)[0];
}

export function planLimits(plan: Record<string, unknown>): PlanLimit[] {
  if (Array.isArray(plan.limits)) {
    return plan.limits.flatMap((l, i) => {
      if (!isObj(l) || typeof l.percent !== 'number') return [];
      const kind = typeof l.kind === 'string' ? l.kind : `limit_${i}`;
      return [
        {
          key: `${kind}:${i}`,
          label: KIND_LABELS[kind] ?? kind.replace(/_/g, ' '),
          percent: clampPct(l.percent),
          resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null,
        },
      ];
    });
  }
  return Object.entries(WINDOW_LABELS).flatMap(([k, label]) => {
    const w = plan[k];
    if (!isObj(w) || typeof w.utilization !== 'number') return [];
    return [
      {
        key: k,
        label,
        percent: clampPct(w.utilization),
        resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
      },
    ];
  });
}

/** Share of this week's usage by product, e.g. Claude Code 93%, Chats 7%. */
export function weeklyBreakdown(plan: Record<string, unknown>): { name: string; percent: number }[] {
  const b = plan.seven_day_breakdown;
  if (!isObj(b) || !Array.isArray(b.rows)) return [];
  return b.rows.flatMap((r) =>
    isObj(r) && typeof r.display_name === 'string' && typeof r.percent === 'number' && r.percent > 0
      ? [{ name: r.display_name, percent: r.percent }]
      : [],
  );
}


export function limitDuration(minutes: unknown): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 'duration unavailable';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  return [[days, 'day'], [hours, 'hour'], [remaining, 'minute']]
    .filter(([amount]) => Number(amount) > 0)
    .map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? '' : 's'}`)
    .join(' ');
}

/** Codex reports its own window durations. Missing windows are unavailable. */
export function codexLimits(plan: Record<string, unknown>): PlanLimit[] {
  const buckets = isObj(plan.rateLimitsByLimitId) && Object.keys(plan.rateLimitsByLimitId).length
    ? Object.entries(plan.rateLimitsByLimitId) : [['codex', plan.rateLimits] as const];
  return buckets.flatMap(([id, bucket]) => {
    if (!isObj(bucket)) return [];
    return ['primary', 'secondary'].flatMap(kind => {
      const w = bucket[kind];
      if (!isObj(w) || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return [];
      const duration = limitDuration(w.windowDurationMins);
      const reset = typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000) : null;
      return [{ key: `${id}:${kind}`, label: `${typeof bucket.limitName === 'string' ? bucket.limitName : id} · ${duration}`,
        windowMinutes: typeof w.windowDurationMins === 'number' ? w.windowDurationMins : undefined,
        percent: clampPct(w.usedPercent), resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null }];
    });
  });
}

/** One reading of a limit: when, and how much of it was used. */
export interface Reading {
  t: number;
  percent: number;
}

/** A limit's window in minutes. Claude's responses don't say, so the key does. */
export function windowMinutes(l: PlanLimit): number {
  return l.windowMinutes ?? (/^(session|five_hour)\b/.test(l.key) ? 300 : 7 * 24 * 60);
}

/**
 * The readings of `limit` within its current window, oldest first: the same limit with the
 * same reset time. A reset time that moves by a few minutes between reads is the same window.
 */
export function limitSeries(history: { t: number; limits: PlanLimit[] }[], limit: PlanLimit): Reading[] {
  const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN;
  // Claude's keys end in the limit's position in the response, which can change.
  const kind = (l: PlanLimit) => l.key.replace(/:\d+$/, '');
  const sameWindow = (l: PlanLimit) => Number.isNaN(reset) || Math.abs((l.resetsAt ? Date.parse(l.resetsAt) : NaN) - reset) < 10 * 60_000;
  return history
    .flatMap((h) => {
      const l = h.limits.find((x) => kind(x) === kind(limit) && sameWindow(x));
      return l ? [{ t: h.t, percent: l.percent }] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * When `limit` runs out at the pace of the last fifth of its window (the last hour of a
 * 5-hour limit, about a day and a half of a weekly one): a time, `'reset'` when it lasts
 * until the reset, or null with too few readings to say.
 */
export function forecast(series: Reading[], limit: PlanLimit, now = Date.now()): number | 'reset' | null {
  const lookback = (windowMinutes(limit) * 60_000) / 5;
  const recent = series.filter((r) => r.t >= now - lookback);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last.t - first.t < Math.min(10 * 60_000, lookback / 6)) return null;
  const rate = (last.percent - first.percent) / (last.t - first.t);
  const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : Infinity;
  if (rate <= 0) return 'reset';
  const at = last.t + (100 - last.percent) / rate;
  return at >= reset ? 'reset' : at;
}

/** "resets in 2h 10m (Tue 14:00)", for a limit's reset time. */
/** The usage chip's short form of `resetsIn`: "45m", "2h 13m", or the day and time past two days. */
export function resetsShort(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function resetsIn(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60_000);
  const when = d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (mins <= 0) return 'resetting now';
  if (mins < 60) return `resets in ${mins}m (${when})`;
  if (mins < 48 * 60) return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m (${when})`;
  return `resets ${when}`;
}
