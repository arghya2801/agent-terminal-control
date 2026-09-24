import { describe, expect, it } from 'vitest';
import {
  candidates,
  filterTasks,
  findSession,
  inRepo,
  linkSession,
  newTask,
  nextId,
  taskForSession,
  unlinkSession,
} from './tasks';
import type { AgentProvider, Project, SessionMeta, Task } from '../types';

function session(id: string, gitBranch: string | null, cwd: string | null, mtimeMs = 0, provider: AgentProvider = 'claude'): SessionMeta {
  return { id, provider, file: `${id}.jsonl`, cwd, gitBranch, label: id, labelSource: 'uuid', mtimeMs, size: 0 };
}

function project(path: string | null, sessions: SessionMeta[]): Project {
  return { key: path?.toLowerCase() ?? '', path, name: path ?? 'Unknown', pinned: false, exists: true, lastActiveMs: 0, sessions };
}

function task(id: number, fields: Partial<Task> = {}): Task {
  return { ...newTask([], fields), id };
}

describe('ids', () => {
  it('continues after the highest id, even with gaps', () => {
    expect(nextId([])).toBe(1);
    expect(nextId([task(2), task(7)])).toBe(8);
  });
});

describe('inRepo', () => {
  it('matches the repo and its subfolders, not siblings sharing a prefix', () => {
    expect(inRepo('D:\\Coding\\atc', 'd:/coding/atc/')).toBe(true);
    expect(inRepo('D:\\Coding\\atc', 'D:\\Coding\\atc\\src')).toBe(true);
    expect(inRepo('D:\\Coding\\atc', 'D:\\Coding\\atc-old')).toBe(false);
    expect(inRepo('D:\\Coding\\atc', null)).toBe(false);
  });
});

describe('candidates', () => {
  const projects = [
    project('D:\\atc', [
      session('a', 'feat/x', null, 10),
      session('b', 'feat/x', 'D:\\atc\\src', 30),
      session('c', 'main', null, 20),
      session('d', 'feat/x', null, 40, 'codex'),
    ]),
    project('D:\\other', [session('e', 'feat/x', null, 50)]),
  ];

  it('offers unlinked sessions on the task branches in its repo, newest first', () => {
    const t = task(1, { repo: 'D:\\atc', branches: ['feat/x'] });
    const other = task(2, { sessions: ['claude:a'] });
    expect(candidates(t, [t, other], projects).map((s) => s.id)).toEqual(['d', 'b']);
  });

  it('offers nothing without a repo or branches', () => {
    expect(candidates(task(1, { branches: ['feat/x'] }), [], projects)).toEqual([]);
    expect(candidates(task(1, { repo: 'D:\\atc' }), [], projects)).toEqual([]);
  });
});

describe('linking', () => {
  const s = session('a', 'feat/y', null);

  it('moves a session between tasks and adds its branch once', () => {
    let tasks = [task(1, { sessions: ['claude:a'] }), task(2, { branches: ['main'] })];
    tasks = linkSession(tasks, 2, s);
    expect(tasks[0].sessions).toEqual([]);
    expect(tasks[1]).toMatchObject({ sessions: ['claude:a'], branches: ['main', 'feat/y'] });
    expect(taskForSession(tasks, 'claude:a')?.id).toBe(2);
    tasks = linkSession(tasks, 2, s);
    expect(tasks[1]).toMatchObject({ sessions: ['claude:a'], branches: ['main', 'feat/y'] });
  });

  it('leaves untouched tasks as the same objects', () => {
    const tasks = [task(1), task(2)];
    expect(linkSession(tasks, 2, s)[0]).toBe(tasks[0]);
  });

  it('unlinks without touching branches', () => {
    const tasks = unlinkSession([task(1, { sessions: ['claude:a'], branches: ['feat/y'] })], 1, 'claude:a');
    expect(tasks[0]).toMatchObject({ sessions: [], branches: ['feat/y'] });
  });
});

describe('findSession and filterTasks', () => {
  it('finds a linked session by provider-qualified key', () => {
    const projects = [project('D:\\atc', [session('a', null, null), session('a', null, null, 0, 'codex')])];
    expect(findSession(projects, 'codex:a')?.session.provider).toBe('codex');
    expect(findSession(projects, 'claude:zzz')).toBeUndefined();
  });

  it('searches titles, branches and notes', () => {
    const tasks = [task(1, { title: 'Fix sort' }), task(2, { branches: ['feat/sort'] }), task(3, { notes: 'nothing' })];
    expect(filterTasks(tasks, 'SORT').map((t) => t.id)).toEqual([1, 2]);
    expect(filterTasks(tasks, '  ')).toBe(tasks);
  });
});
