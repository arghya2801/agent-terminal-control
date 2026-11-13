import type { TabMark } from './format';

/** Most urgent first: the agents that are blocked on you, then the ones that will be. */
const URGENCY: Record<TabMark, number> = { blocked: 0, attention: 0, interrupted: 1, idle: 2, working: 3, open: 4, exited: 5 };

export interface Triaged {
  key: string;
  mark: TabMark;
  /** When the tab entered `mark`. */
  since: number;
  /** Marked done by the user: waiting, but not on you. Cleared when the agent works again. */
  done?: boolean;
}

/** Done agents sort after shells, before exited tabs. An agent asking a question or for
 *  permission comes first; the rest waiting on you rank the same. */
const rank = (t: Triaged) => (!isWaiting(t.mark) ? URGENCY[t.mark] : t.done ? 4.5 : t.mark === 'blocked' ? -1 : 0);

/** Urgency, then the agent that started waiting on you most recently, then whoever has
 *  been in any other state longest. Stable for equal entries. */
export function triageOrder<T extends Triaged>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => rank(a) - rank(b) || (rank(a) <= 0 ? b.since - a.since : a.since - b.since));
}

/** The agent that has waited longest for you, other than the one on screen. */
export function nextWaiting<T extends Triaged>(tabs: T[], activeKey: string | null): T | null {
  const waiting = tabs.filter((t) => t.key !== activeKey && isWaiting(t.mark) && !t.done);
  return waiting.reduce<T | null>((a, t) => (!a || t.since < a.since ? t : a), null);
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
  return { blocked: 'asking', attention: 'waiting', interrupted: 'stopped', idle: 'idle', working: 'working', open: '', exited: 'exited' }[mark];
}

