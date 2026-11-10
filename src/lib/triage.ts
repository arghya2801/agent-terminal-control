import type { TabMark } from './format';

/** Most urgent first: the agents that are blocked on you, then the ones that will be. */
const URGENCY: Record<TabMark, number> = { attention: 0, interrupted: 1, idle: 2, working: 3, open: 4, exited: 5 };

export interface Triaged {
  key: string;
  mark: TabMark;
  /** When the tab entered `mark`. */
  since: number;
  /** Marked done by the user: waiting, but not on you. Cleared when the agent works again. */
  done?: boolean;
}

/** Done agents sort after shells, before exited tabs. */
const rank = (t: Triaged) => (t.done && isWaiting(t.mark) ? 4.5 : URGENCY[t.mark]);

/** Urgency, then whoever has been in that state longest. Stable for equal entries. */
export function triageOrder<T extends Triaged>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => rank(a) - rank(b) || a.since - b.since);
}

/** The agent that has waited longest for you, other than the one on screen. */
export function nextWaiting<T extends Triaged>(tabs: T[], activeKey: string | null): T | null {
  return triageOrder(tabs).find((t) => t.key !== activeKey && isWaiting(t.mark) && !t.done) ?? null;
}

/** Blocked until you answer: finished, stopped or idle. */
export function isWaiting(mark: TabMark): boolean {
  return URGENCY[mark] <= URGENCY.idle;
}

/** The Open view's section for a mark. Rows in triage order keep each section together. */
export function triageGroup(mark: TabMark, done = false): string {
  return isWaiting(mark) ? (done ? 'Done' : 'Waiting on you') : { working: 'Working', open: 'Shells', exited: 'Exited' }[mark as 'working' | 'open' | 'exited'];
}

/** What the row says about how long it has been in its state. */
export function stateWord(mark: TabMark): string {
  return { attention: 'waiting', interrupted: 'stopped', idle: 'idle', working: 'working', open: '', exited: 'exited' }[mark];
}

