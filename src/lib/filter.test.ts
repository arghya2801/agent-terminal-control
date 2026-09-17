import { describe, expect, it } from 'vitest';
import { filterProjects } from './filter';
import type { Project, SessionMeta } from '../types';

const session = (id: string, label: string, gitBranch: string | null = null): SessionMeta => ({
  id,
  file: `${id}.jsonl`,
  cwd: null,
  gitBranch,
  label,
  labelSource: 'agentName',
  mtimeMs: 1,
  size: 1,
});

const project = (name: string, path: string, sessions: SessionMeta[]): Project => ({
  key: path.toLowerCase(),
  path,
  name,
  pinned: false,
  exists: true,
  lastActiveMs: 1,
  sessions,
});

const projects = [
  project('atc', 'D:\Coding\claude-code-pseudo-gui', [
    session('a', 'fix-copy-paste', 'main'),
    session('b', 'usage-graph', 'feat/usage'),
  ]),
  project('game_tracker_app', 'D:\Coding\game_tracker_app', [
    session('c', 'polish-scoreboard', 'main'),
  ]),
];

describe('filterProjects', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterProjects(projects, '')).toBe(projects);
    expect(filterProjects(projects, '   ')).toBe(projects);
  });

  it('keeps every session of a project whose name matches', () => {
    const r = filterProjects(projects, 'ATC');
    expect(r).toHaveLength(1);
    expect(r[0].sessions).toHaveLength(2);
  });

  it('matches the path, so a renamed project is still found by its folder', () => {
    const r = filterProjects(projects, 'pseudo-gui');
    expect(r.map((p) => p.name)).toEqual(['atc']);
  });

  it('narrows to matching sessions by label or branch', () => {
    expect(filterProjects(projects, 'scoreboard')[0].sessions.map((s) => s.id)).toEqual(['c']);
    expect(filterProjects(projects, 'feat/usage')[0].sessions.map((s) => s.id)).toEqual(['b']);
  });

  it('keeps sessions from several projects when they match', () => {
    const r = filterProjects(projects, 'main');
    expect(r.map((p) => p.sessions.map((s) => s.id))).toEqual([['a'], ['c']]);
  });

  it('drops projects with nothing matching', () => {
    expect(filterProjects(projects, 'nothing-like-this')).toEqual([]);
  });

  it('does not mutate the input', () => {
    filterProjects(projects, 'scoreboard');
    expect(projects[1].sessions).toHaveLength(1);
    expect(projects[0].sessions).toHaveLength(2);
  });
});
