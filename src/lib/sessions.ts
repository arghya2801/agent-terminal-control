/**
 * Working out which sidebar session each tab is showing.
 *
 * A resumed tab carries its session id in its key and needs no working out. A tab started
 * with "Open Claude here" or the scratch pad does not: Claude picks the session id itself,
 * after the shell is already running, and never tells us.
 *
 * This used to be matched on the name Claude puts in its title against the sidebar's
 * label, which is unreliable in both directions and fails worst at the moment it matters.
 * A transcript carries two names — `agentName` (what Claude calls the session now) and
 * `aiTitle` (a summary of the first prompt) — and the sidebar label prefers the first
 * while the title may be showing the other. A brand-new session has *neither* for its
 * first couple of dozen transcript lines, which is exactly when the tab is opened.
 *
 * So identity comes from the directory and the clock instead: a tab opened at time T in
 * directory D owns the session in D whose transcript has been written since T. The name is
 * kept only as a first pass, because when it does agree it is exact and instant.
 */

import { samePath } from './paths';
import type { Project, SessionMeta, TabKey } from '../types';

export interface TabRef {
  key: TabKey;
  projectKey: string | null;
  /** Directory the shell started in. The strongest key we have. */
  cwd: string | null;
  /** Name from Claude's title, when it set one. */
  claudeName: string | null;
  /** When the tab was opened, so a session can be told apart from ones already there. */
  startedAt: number;
}

/** A session with the directory it belongs to, which may come from its project. */
interface Candidate {
  session: SessionMeta;
  dir: string | null;
  projectKey: string;
}

/**
 * Map every tab to the session it is showing. Tabs without one are simply absent.
 *
 * One session is never given to two tabs: opening the same project twice must not light
 * up the same row for both.
 */
export function resolveSessions(tabs: TabRef[], projects: Project[]): Map<TabKey, string> {
  const out = new Map<TabKey, string>();
  const claimed = new Set<string>();

  // Resumed tabs first: their id is certain, so they get first claim on it.
  for (const t of tabs) {
    if (!t.key.startsWith('session:')) continue;
    const id = t.key.slice('session:'.length);
    out.set(t.key, id);
    claimed.add(id);
  }

  const candidates: Candidate[] = projects.flatMap((p) =>
    p.sessions.map((session) => ({ session, dir: session.cwd ?? p.path, projectKey: p.key })),
  );

  // Newest tab first. With one tab in a directory — the ordinary case — this changes
  // nothing. With two, the most recently opened tab takes the most recently written
  // session, which is the better guess: transcripts carry a last-written time, not a
  // created time, so there is nothing exact to pair them on.
  const pending = tabs
    .filter((t) => t.key.startsWith('claude:'))
    .sort((a, b) => b.startedAt - a.startedAt);

  for (const tab of pending) {
    const mine = candidates.filter((c) => !claimed.has(c.session.id) && belongsTo(c, tab));

    // The name, when Claude has set one and it agrees with the sidebar. Exact and instant.
    const byName = tab.claudeName
      ? mine.find((c) => c.session.label === tab.claudeName)
      : undefined;

    // Otherwise the session written since this tab opened. A transcript that has not been
    // touched since then belonged to someone else.
    const byRecency = mine
      .filter((c) => c.session.mtimeMs >= tab.startedAt)
      .sort((a, b) => b.session.mtimeMs - a.session.mtimeMs)[0];

    const hit = byName ?? byRecency;
    if (!hit) continue;
    out.set(tab.key, hit.session.id);
    claimed.add(hit.session.id);
  }

  return out;
}

/**
 * Whether a session sits in the directory a tab was opened in. The recorded cwd is the
 * real test; the project key is the fallback for a transcript that recorded no directory.
 */
function belongsTo(c: Candidate, tab: TabRef): boolean {
  if (tab.cwd && c.dir) return samePath(tab.cwd, c.dir);
  return tab.projectKey !== null && tab.projectKey === c.projectKey;
}
