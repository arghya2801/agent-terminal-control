/**
 * Local tasks: pure helpers over `Settings.tasks`. A task names branches in one repo (or
 * none), and links sessions by `provider:id` — the same key the sidebar uses.
 */

import { sessionKey } from './agents';
import { projectKey } from './paths';
import type { Project, SessionMeta, Task, TaskState } from '../types';

export const TASK_STATES: { state: TaskState; label: string }[] = [
  { state: 'doing', label: 'In progress' },
  { state: 'todo', label: 'To do' },
  { state: 'done', label: 'Done' },
];

export function nextId(tasks: Task[]): number {
  return Math.max(0, ...tasks.map((t) => t.id)) + 1;
}

export function newTask(tasks: Task[], fields: Partial<Task> = {}): Task {
  return {
    id: nextId(tasks),
    title: 'New task',
    state: 'todo',
    repo: null,
    branches: [],
    notes: '',
    sessions: [],
    ...fields,
  };
}

/** The task a session is linked to. A session belongs to at most one. */
export function taskForSession(tasks: Task[], key: string): Task | undefined {
  return tasks.find((t) => t.sessions.includes(key));
}

/** Whether `dir` is `repo` or somewhere inside it. */
export function inRepo(repo: string, dir: string | null): boolean {
  if (!dir) return false;
  const r = projectKey(repo);
  const d = projectKey(dir);
  return d === r || d.startsWith(r + '\\');
}

/** The directory a session ran in, falling back to its project's. */
function sessionDir(p: Project, s: SessionMeta): string | null {
  return s.cwd ?? p.path;
}

/**
 * Sessions offered for linking: they ran on one of the task's branches inside its repo,
 * and are not linked to any task yet. Newest first.
 */
export function candidates(task: Task, tasks: Task[], projects: Project[]): SessionMeta[] {
  if (!task.repo || task.branches.length === 0) return [];
  const repo = task.repo;
  const linked = new Set(tasks.flatMap((t) => t.sessions));
  return projects
    .flatMap((p) =>
      p.sessions.filter(
        (s) =>
          !!s.gitBranch &&
          task.branches.includes(s.gitBranch) &&
          inRepo(repo, sessionDir(p, s)) &&
          !linked.has(sessionKey(s)),
      ),
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Link a session to `taskId`, moving it off any other task. Its branch joins the task's
 * branches when missing, so the task keeps naming where its work happened.
 */
export function linkSession(tasks: Task[], taskId: number, s: SessionMeta): Task[] {
  const key = sessionKey(s);
  return tasks.map((t) => {
    const sessions = t.sessions.filter((k) => k !== key);
    if (t.id !== taskId) return sessions.length === t.sessions.length ? t : { ...t, sessions };
    const branches =
      s.gitBranch && !t.branches.includes(s.gitBranch) ? [...t.branches, s.gitBranch] : t.branches;
    return { ...t, sessions: [...sessions, key], branches };
  });
}

export function unlinkSession(tasks: Task[], taskId: number, key: string): Task[] {
  return updateTask(tasks, taskId, (t) => ({ ...t, sessions: t.sessions.filter((k) => k !== key) }));
}

export function updateTask(tasks: Task[], id: number, change: (t: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === id ? change(t) : t));
}

/** Find a linked session in the index, with the project it belongs to. */
export function findSession(
  projects: Project[],
  key: string,
): { project: Project; session: SessionMeta } | undefined {
  for (const project of projects) {
    const session = project.sessions.find((s) => sessionKey(s) === key);
    if (session) return { project, session };
  }
  return undefined;
}

/** Sidebar search over tasks: title, branches, notes. */
export function filterTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((t) => `${t.title} ${t.branches.join(' ')} ${t.notes}`.toLowerCase().includes(q));
}
