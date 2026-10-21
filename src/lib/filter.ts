import type { Project } from '../types';

/**
 * Sidebar search. A project whose name or path matches keeps every session; otherwise
 * only its matching sessions (label or git branch) remain, and a project left with
 * none is dropped. Case-insensitive; an empty query returns the list unchanged.
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  const hit = (s: string | null) => !!s && s.toLowerCase().includes(q);

  return projects.flatMap((p) => {
    if (hit(p.name) || hit(p.path)) return [p];
    const sessions = p.sessions.filter((s) => hit(s.label) || hit(s.gitBranch));
    return sessions.length > 0 ? [{ ...p, sessions }] : [];
  });
}

/** `text` cut around each case-insensitive match of `query`: odd indexes are matches. */
export function splitMatches(text: string, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [text];
  const lower = text.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    parts.push(text.slice(from, at), text.slice(at, at + q.length));
    from = at + q.length;
  }
  parts.push(text.slice(from));
  return parts;
}
