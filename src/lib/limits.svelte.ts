import { claudeUsage, codexUsage, usageContext, usageCosts } from './ipc';
import { dailyTotals, localDay } from './costs';
import type { CostRow } from '../types';

/**
 * Plan limits for the whole app. The tab bar's chip, its hover peek and the usage page
 * all read this one answer, so the rate-limited endpoint is asked once, not per view.
 */
export const planState = $state({
  claude: null as Record<string, unknown> | null,
  claudeError: null as string | null,
  claudeLoading: false,
  claudeAt: 0,
  codex: null as Record<string, unknown> | null,
  /** The last read found no Codex installed. */
  codexMissing: false,
  codexError: null as string | null,
  codexLoading: false,
  codexAt: 0,
  /** Today's API-equivalent spend, for the peek; null until read or when unreadable. */
  today: null as number | null,
  /** Every transcript's usage by hour, for the header's session stats. */
  costRows: [] as CostRow[],
  /** How full each session's context window is, by `provider:sessionId`. */
  context: {} as Record<string, { used: number; window: number }>,
});

export async function loadClaudeLimits() {
  if (planState.claudeLoading) return;
  planState.claudeLoading = true;
  try {
    planState.claude = await claudeUsage();
    planState.claudeError = null;
  } catch (e) {
    planState.claudeError = String(e);
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

export async function loadContext() {
  try {
    planState.context = await usageContext();
  } catch {
    // Keeps the last answer; the next transcript change asks again.
  }
}

export async function loadCosts() {
  try {
    planState.costRows = await usageCosts();
    planState.today = dailyTotals(planState.costRows, 'cost').get(localDay(new Date())) ?? 0;
  } catch {
    planState.today = null;
  }
}
