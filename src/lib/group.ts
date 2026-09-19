/**
 * Optional sidebar grouping: sessions started in a subfolder appear under the project
 * they sit inside, instead of as a separate project of their own.
 *
 * The rule is the one the Usage page already rolls spend up by — nearest listed ancestor,
 * via `owningProject` — so the two pages agree on what belongs to what. A grouped session
 * keeps its own recorded directory, so resuming it still lands where it was.
 */

import { owningProject } from './costs';
import type { Project } from '../types';

/**
 * Merge each project into its nearest listed ancestor. Order is preserved: a parent keeps
 * its place, and a child that has no listed ancestor stays where it was.
 *
 * Projects with no usable path (the Unknown group) are never a parent or a child; there
 * is no path to compare, so any grouping would be a guess.
 */
export function groupSubfolders(projects: Project[]): Project[] {
  const keys = projects.filter((p) => p.path !== null).map((p) => p.key);
  const byKey = new Map(projects.map((p) => [p.key, p]));

  /**
   * The ancestor a project's sessions move to, or null to keep it standalone.
   *
   * `owningProject` prefers the longest matching key, which is the project itself when it
   * is in the list, so candidates exclude it: what is wanted here is a strict ancestor.
   */
  const parentOf = (p: Project): string | null => {
    if (p.path === null) return null;
    // ponytail: rebuilds the candidate list per project. Sidebars hold dozens of
    // projects; if that ever becomes thousands, sort the keys once and binary-search.
    return owningProject(
      p.key,
      keys.filter((k) => k !== p.key),
    );
  };

  const adopted = new Map<string, Project['sessions']>();
  for (const p of projects) {
    const parent = parentOf(p);
    if (!parent) continue;
    // Walk to the top, so a grandchild lands under the root rather than under a middle
    // folder that is itself grouped away.
    let root = parent;
    for (let hop = 0; hop < projects.length; hop += 1) {
      const next = parentOf(byKey.get(root)!);
      if (!next) break;
      root = next;
    }
    adopted.set(root, [...(adopted.get(root) ?? []), ...p.sessions]);
  }

  return projects.flatMap((p) => {
    if (parentOf(p)) return [];
    const extra = adopted.get(p.key);
    if (!extra) return [p];
    const sessions = [...p.sessions, ...extra].sort((a, b) => b.mtimeMs - a.mtimeMs);
    return [
      {
        ...p,
        sessions,
        lastActiveMs: Math.max(p.lastActiveMs, ...extra.map((s) => s.mtimeMs)),
      },
    ];
  });
}

/**
 * The part of a session's directory below its project, e.g. `src-tauri`. Empty when the
 * session sits in the project directory itself, which is every session when grouping is
 * off. Shown on the row so two sessions with the same name stay tellable apart.
 */
export function subfolderLabel(projectPath: string | null, cwd: string | null): string {
  if (!projectPath || !cwd) return '';
  const norm = (s: string) => s.replace(/\//g, '\\').replace(/\\+$/, '');
  const parent = norm(projectPath);
  const child = norm(cwd);
  if (!child.toLowerCase().startsWith(`${parent.toLowerCase()}\\`)) return '';
  return child.slice(parent.length + 1);
}
