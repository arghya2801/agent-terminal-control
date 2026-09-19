/**
 * The date range the spend section is showing, and what gets remembered between launches.
 *
 * A preset is stored as itself rather than as the dates it resolved to, so "7 days" still
 * means the last 7 days tomorrow. A hand-picked range is stored alongside it, so choosing
 * a preset does not throw it away — see #58.
 */

import { localDay } from './costs';

/** `null` days means all time. */
export type Selection = { kind: 'preset'; days: number | null } | { kind: 'custom' };

export interface Dates {
  from: string;
  to: string;
}

export interface SavedRange {
  selection: Selection;
  /** The last range picked by hand, restorable from the Custom button. */
  custom: Dates | null;
}

/** Bounds for the "last N days" box. One day is Today; beyond a year, use All time. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 366;

/** Anything before Claude Code existed reads as all of it. */
const EPOCH = '2000-01-01';

export function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)));
}

/** Dates for a preset. `days` counts today as the first day, so 1 is Today. */
export function presetDates(days: number | null, now = new Date()): Dates {
  const to = localDay(now);
  if (days === null) return { from: EPOCH, to };
  const span = clampDays(days);
  return { from: localDay(new Date(now.getTime() - (span - 1) * 86_400_000)), to };
}

/** True when a preset button should read as the current selection. */
export function isActive(sel: Selection, days: number | null): boolean {
  return sel.kind === 'preset' && sel.days === days;
}

/**
 * Reads what was stored, tolerating both the older shapes: a bare preset object, and a
 * bare `{from, to}` from before a custom range was nameable.
 */
export function parseSaved(raw: string | null): SavedRange | null {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;

  const custom = isDates(o.custom) ? o.custom : null;
  const sel = o.selection;
  if (typeof sel === 'object' && sel !== null) {
    const s = sel as Record<string, unknown>;
    if (s.kind === 'custom') {
      // A custom selection with nothing to restore would show an empty range.
      return custom ? { selection: { kind: 'custom' }, custom } : null;
    }
    if (s.kind === 'preset' && (s.days === null || typeof s.days === 'number')) {
      return { selection: { kind: 'preset', days: s.days as number | null }, custom };
    }
    return null;
  }

  // --- older shapes
  if ('preset' in o && (o.preset === null || typeof o.preset === 'number')) {
    return { selection: { kind: 'preset', days: o.preset as number | null }, custom };
  }
  if (isDates(o)) return { selection: { kind: 'custom' }, custom: o };
  return null;
}

function isDates(v: unknown): v is Dates {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return isDay(o.from) && isDay(o.to);
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
