import { samePath } from './paths';
import { qualifiedSession, sessionKey } from './agents';
import type { AgentProvider, Project, SessionMeta, TabKey } from '../types';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** The first message of a fresh session that carries on from `s` (#294): where its transcript is, what was last asked and said. */
export function handoffPrompt(s: Pick<SessionMeta, 'provider' | 'id' | 'file'>, turns: { role: string; text: string }[]): string {
  const prompts = turns.filter((t) => t.role === 'user').slice(-3);
  const reply = turns.findLast((t) => t.role === 'assistant');
  return [
    `Carry on from an earlier ${s.provider} session. Its id is ${s.id} and its transcript is ${s.file}; read it only if you need more than this.`,
    prompts.length && `Last prompts:\n${prompts.map((t) => `- ${clip(t.text, 400)}`).join('\n')}`,
    reply && `Last reply:\n${clip(reply.text, 800)}`,
    'Wait for my next instruction.',
  ].filter(Boolean).join('\n\n');
}

export interface TabRef {
  key: TabKey;
  provider?: AgentProvider | null;
  boundSession?: string | null;
  existingSessions?: string[];
  projectKey: string | null;
  cwd: string | null;
  claudeName: string | null;
  startedAt: number;
}

/** A binding survives later recency and title changes. Ambiguous launches stay unbound. */
export function resolveSessions(tabs: TabRef[], projects: Project[]): Map<TabKey, string> {
  const out = new Map<TabKey, string>();
  const claimed = new Set<string>();
  for (const tab of tabs) {
    const id = tab.boundSession ?? (tab.key.startsWith('session:') ? qualifiedSession(tab.key.slice(8)) : null);
    if (id) { out.set(tab.key, id); claimed.add(id); }
  }
  const sessions = projects.flatMap((project) => project.sessions.map((session) => ({ project, session })));
  const plain = sessions.map(({ session }) => session);
  for (const tab of tabs) {
    const bound = out.get(tab.key);
    const moved = bound ? resumedInto(tab, bound, plain, claimed) : null;
    if (moved) { out.set(tab.key, moved); claimed.add(moved); }
  }
  const candidates = new Map<TabKey, string[]>();
  for (const tab of tabs) {
    const provider = tab.provider ?? (tab.key.startsWith('claude:') ? 'claude' : null);
    if (!provider || out.has(tab.key) || (!tab.cwd && !tab.projectKey)) continue;
    let mine = sessions.filter(({ project, session: s }) => s.provider === provider &&
      (s.cwd && tab.cwd ? samePath(s.cwd, tab.cwd) : !s.cwd &&
        ((tab.projectKey && project.key === tab.projectKey) ||
          (tab.cwd && project.path && samePath(project.path, tab.cwd)))) &&
      !claimed.has(sessionKey(s)) && !tab.existingSessions?.includes(sessionKey(s)) &&
      (provider === 'codex' ? s.createdAtMs ?? 0 : s.mtimeMs) >= tab.startedAt);
    if (provider === 'claude' && tab.claudeName) {
      const named = mine.filter(({ session }) => session.label === tab.claudeName);
      if (named.length === 1) mine = named;
    }
    candidates.set(tab.key, mine.map(({ session }) => sessionKey(session)));
  }
  // Assign a sole candidate, then remove it from other tabs and repeat. Two tabs
  // with the same sole candidate still remain unbound.
  while (true) {
    const singles = [...candidates].filter(([, ids]) => ids.length === 1);
    const unique = singles.filter(([, ids]) => singles.filter(([, other]) => other[0] === ids[0]).length === 1);
    if (unique.length === 0) break;
    for (const [key, [id]] of unique) {
      out.set(key, id);
      candidates.delete(key);
    }
    const assigned = new Set(unique.map(([, [id]]) => id));
    for (const [key, ids] of candidates) candidates.set(key, ids.filter((id) => !assigned.has(id)));
  }
  return out;
}

/**
 * The session a tab switched to with `/resume` (#75), or null. It existed before the tab
 * opened, so the launch rules never pick it. Taken only when exactly one other session of
 * the tab's agent, in its directory and unclaimed, was written after the bound one; for
 * Claude it must also carry the name in the tab's title when there is one.
 */
function resumedInto(tab: TabRef, bound: string, sessions: SessionMeta[], claimed: Set<string>): string | null {
  const current = sessions.find((s) => sessionKey(s) === bound);
  if (!current || !tab.provider || !tab.cwd) return null;
  const later = sessions.filter((s) => s.provider === tab.provider && s.cwd && samePath(s.cwd, tab.cwd!) &&
    !claimed.has(sessionKey(s)) && s.mtimeMs > current.mtimeMs && s.mtimeMs >= tab.startedAt &&
    (tab.provider !== 'claude' || !tab.claudeName || s.label === tab.claudeName));
  // ponytail: mtime order only; an agent run outside ATC in the same directory can look
  // like a resume for Codex, which has no title name to check against.
  return later.length === 1 ? sessionKey(later[0]) : null;
}
