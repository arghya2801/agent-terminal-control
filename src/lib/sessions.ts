import { samePath } from './paths';
import { qualifiedSession, sessionKey } from './agents';
import type { AgentProvider, Project, TabKey } from '../types';

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
