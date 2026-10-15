import type { TabMark } from './format';

/** Most urgent first: the agents that are blocked on you, then the ones that will be. */
const URGENCY: Record<TabMark, number> = { attention: 0, interrupted: 1, idle: 2, working: 3, open: 4, exited: 5 };

export interface Triaged {
  key: string;
  mark: TabMark;
  /** When the tab entered `mark`. */
  since: number;
}

/** Urgency, then whoever has been in that state longest. Stable for equal entries. */
export function triageOrder<T extends Triaged>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => URGENCY[a.mark] - URGENCY[b.mark] || a.since - b.since);
}

/** The agent that has waited longest for you, other than the one on screen. */
export function nextWaiting<T extends Triaged>(tabs: T[], activeKey: string | null): T | null {
  return triageOrder(tabs).find((t) => t.key !== activeKey && URGENCY[t.mark] <= URGENCY.idle) ?? null;
}

/** What the row says about how long it has been in its state. */
export function stateWord(mark: TabMark): string {
  return { attention: 'waiting', interrupted: 'stopped', idle: 'idle', working: 'working', open: '', exited: 'exited' }[mark];
}

// ponytail: chrome patterns copied from what Claude Code and Codex draw today; a TUI
// redesign will leak its status bar into the peek until this list catches up.
const CHROME = /^(>|›|\?\s+for shortcuts|esc to|⏵|⏎|ctrl\+|shift\+tab|\d+% context|tab to)/i;

/**
 * The last line of a terminal worth reading, bottom up: no blank lines, no box-drawing
 * borders, no prompt or key hints. Null when the screen holds nothing but chrome.
 */
export function peekLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].replace(/[│┃╭╮╰╯─━┌┐└┘├┤▐▛▜▌▝▘█]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || !/\p{L}{2}/u.test(text) || CHROME.test(text)) continue;
    return text;
  }
  return null;
}
