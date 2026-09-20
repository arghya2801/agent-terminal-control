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
  const sessions = projects.flatMap(p => p.sessions);
  const candidates = new Map<TabKey, string[]>();
  for (const tab of tabs) {
    const provider = tab.provider ?? (tab.key.startsWith('claude:') ? 'claude' : null);
    if (!provider || out.has(tab.key) || !tab.cwd) continue;
    let mine = sessions.filter(s => s.provider === provider && s.cwd && samePath(s.cwd, tab.cwd!) &&
      !claimed.has(sessionKey(s)) && !tab.existingSessions?.includes(sessionKey(s)) &&
      (provider === 'codex' ? s.createdAtMs ?? 0 : s.mtimeMs) >= tab.startedAt);
    if (provider === 'claude' && tab.claudeName) {
      const named = mine.filter(s => s.label === tab.claudeName);
      if (named.length === 1) mine = named;
    }
    candidates.set(tab.key, mine.map(sessionKey));
  }
  for (const [key, ids] of candidates) {
    if (ids.length !== 1) continue;
    const id = ids[0];
    if ([...candidates].some(([other, matches]) => other !== key && matches.includes(id))) continue;
    out.set(key, id);
  }
  return out;
}
