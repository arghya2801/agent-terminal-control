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
        percent: clampPct(w.usedPercent), resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null }];
    });
  });
}
