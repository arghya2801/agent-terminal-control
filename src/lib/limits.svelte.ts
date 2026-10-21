import { claudeUsage, codexUsage, usageCosts } from './ipc';
import { dailyTotals, localDay } from './costs';

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

export async function loadTodaySpend() {
  try {
    planState.today = dailyTotals(await usageCosts(), 'cost').get(localDay(new Date())) ?? 0;
  } catch {
    planState.today = null;
  }
}
