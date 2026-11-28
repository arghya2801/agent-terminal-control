import { claudeUsage, codexUsage, limitsHistory, usageContext, usageCosts } from './ipc';
import { codexLimits, planLimits, type PlanLimit } from './plan';
import { dailyTotals, localDay } from './costs';
import type { CostRow } from '../types';

/**
 * Plan limits for the whole app. The tab bar's chip, its hover peek and the usage page
 * all read this one answer, so the rate-limited endpoint is asked once, not per view.
 */
/// A class so the big, only-replaced fields can be raw.
class PlanState {
  claude = $state<Record<string, unknown> | null>(null);
  claudeError = $state<string | null>(null);
  claudeLoading = $state(false);
  claudeAt = $state(0);
  codex = $state<Record<string, unknown> | null>(null);
  /** The last read found no Codex installed. */
  codexMissing = $state(false);
  codexError = $state<string | null>(null);
  codexLoading = $state(false);
  codexAt = $state(0);
  /** Today's API-equivalent spend, for the peek; null until read or when unreadable. */
  today = $state<number | null>(null);
  /** Every transcript's usage by hour, for the header's session stats. */
  costRows = $state.raw<CostRow[]>([]);
  costError = $state<string | null>(null);
  /** Past readings, for how fast each limit fills (#27, #161). */
  claudeHistory = $state.raw<{ t: number; limits: PlanLimit[] }[]>([]);
  codexHistory = $state.raw<{ t: number; limits: PlanLimit[] }[]>([]);
  /** How full each session's context window is, by `provider:sessionId`. */
  context = $state.raw<Record<string, { used: number; window: number; first?: number }>>({});
}
export const planState = new PlanState();

let costsLoading: Promise<void> | null = null;

export async function loadClaudeLimits() {
  if (planState.claudeLoading) return;
  planState.claudeLoading = true;
  try {
    planState.claude = await claudeUsage();
    planState.claudeError = null;
  } catch (e) {
    planState.claudeError = e instanceof Error ? e.message : String(e);
  } finally {
    planState.claudeAt = Date.now();
    planState.claudeLoading = false;
  }
}

/** Each read starts and stops a `codex app-server`, so callers keep these rare. */
export async function loadCodexLimits() {
  if (planState.codexLoading) return;
  planState.codexLoading = true;
  try {
    const plan = await codexUsage();
    planState.codexMissing = plan === null;
    planState.codex = plan;
    planState.codexError = null;
  } catch (e) {
    planState.codexMissing = false;
    planState.codexError = String(e);
  } finally {
    planState.codexAt = Date.now();
    planState.codexLoading = false;
  }
}

export async function loadLimitsHistory() {
  try {
    const all = await limitsHistory();
    const read = (provider: 'claude' | 'codex', parse: (b: Record<string, unknown>) => PlanLimit[]) =>
      all.filter((h) => h.provider === provider).map((h) => ({ t: h.t, limits: parse(h.body) }));
    planState.claudeHistory = read('claude', planLimits);
    planState.codexHistory = read('codex', codexLimits);
  } catch {
    // No history yet means no forecast, not an error.
  }
}

export async function loadContext() {
  try {
    planState.context = await usageContext();
  } catch {
    // Keeps the last answer; the next transcript change asks again.
  }
}

/** Callers that arrive during a read share it. */
export function loadCosts(): Promise<void> {
  costsLoading ??= (async () => {
    try {
      planState.costRows = await usageCosts();
      planState.today = dailyTotals(planState.costRows, 'cost').get(localDay(new Date())) ?? 0;
      planState.costError = null;
    } catch (e) {
      planState.today = null;
      planState.costError = String(e);
    } finally {
      costsLoading = null;
    }
  })();
  return costsLoading;
}
