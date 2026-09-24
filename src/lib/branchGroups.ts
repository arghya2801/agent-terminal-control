import type { SessionMeta } from '../types';

export interface BranchGroup {
  /** Null for sessions that recorded no branch. */
  branch: string | null;
  sessions: SessionMeta[];
}

/**
 * Sessions grouped by the branch they ran on, as the transcript recorded it. Groups keep
 * the order of their newest session; sessions with no branch come last.
 */
export function branchGroups(sessions: SessionMeta[]): BranchGroup[] {
  const groups = new Map<string | null, SessionMeta[]>();
  for (const s of sessions) {
    const key = s.gitBranch || null;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const newest = (g: SessionMeta[]) => Math.max(...g.map((s) => s.mtimeMs));
  return [...groups]
    .map(([branch, list]) => ({ branch, sessions: list }))
    .sort((a, b) =>
      a.branch === null ? 1 : b.branch === null ? -1 : newest(b.sessions) - newest(a.sessions),
    );
}
