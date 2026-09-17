/**
 * Which tabs to reopen on launch. Stored in localStorage, so it is read back as
 * untrusted: anything malformed is dropped rather than half-restored.
 */

export type SavedTab =
  /** A Claude session, resumed with its id. */
  | { kind: 'session'; sessionId: string; cwd: string; projectKey: string | null; customTitle: string | null }
  /** A shell. `project` marks the one tab a project row opens, so it is reused again. */
  | { kind: 'shell'; cwd: string | null; projectKey: string | null; project: boolean; customTitle: string | null };

export interface SavedTabs {
  tabs: SavedTab[];
  /** Index into `tabs` of the focused tab. */
  active: number;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strOrNull = (v: unknown): string | null => (str(v) ? v : null);

function parseTab(v: unknown): SavedTab | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const common = { projectKey: strOrNull(t.projectKey), customTitle: strOrNull(t.customTitle) };
  if (t.kind === 'session' && str(t.sessionId) && str(t.cwd)) {
    return { kind: 'session', sessionId: t.sessionId, cwd: t.cwd, ...common };
  }
  if (t.kind === 'shell') {
    return { kind: 'shell', cwd: strOrNull(t.cwd), project: t.project === true, ...common };
  }
  return null;
}

export function parseSavedTabs(text: string | null): SavedTabs | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as SavedTabs).tabs)) return null;
  const all = (raw as { tabs: unknown[] }).tabs;
  const tabs: SavedTab[] = [];
  let active = 0;
  const wanted = (raw as { active?: unknown }).active;
  all.forEach((v, i) => {
    const t = parseTab(v);
    if (!t) return;
    if (i === wanted) active = tabs.length;
    tabs.push(t);
  });
  return tabs.length > 0 ? { tabs, active } : null;
}
