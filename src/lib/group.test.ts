import { describe, expect, it } from 'vitest';
import { groupSubfolders, subfolderLabel } from './group';
import type { Project, SessionMeta } from '../types';

let seq = 0;
function session(mtimeMs: number, cwd: string | null = null): SessionMeta {
  seq += 1;
  return {
    id: `s${seq}`,
    provider: 'claude',
    file: `s${seq}.jsonl`,
    cwd,
    gitBranch: null,
    label: `session ${seq}`,
    labelSource: 'uuid',
    mtimeMs,
    size: 0,
  };
}

function project(path: string | null, sessions: SessionMeta[]): Project {
  return {
    key: path ? path.toLowerCase() : '',
    path,
    name: path?.split('\\').pop() ?? 'Unknown',
    pinned: false,
    exists: true,
    lastActiveMs: Math.max(0, ...sessions.map((s) => s.mtimeMs)),
    sessions,
  };
}

describe('groupSubfolders', () => {
  it('moves a subfolder’s sessions under the parent and drops the child row', () => {
    const parent = project('D:\\Coding\\app', [session(100)]);
    const child = project('D:\\Coding\\app\\src-tauri', [session(200)]);

    const out = groupSubfolders([parent, child]);

    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(parent.key);
    expect(out[0].sessions.map((s) => s.mtimeMs)).toEqual([200, 100]);
    expect(out[0].lastActiveMs).toBe(200);
  });

  it('leaves unrelated projects alone', () => {
    const a = project('D:\\Coding\\app', [session(1)]);
    const b = project('D:\\Other\\thing', [session(2)]);
    expect(groupSubfolders([a, b]).map((p) => p.key)).toEqual([a.key, b.key]);
  });

  it('is a no-op when nothing nests', () => {
    const list = [project('D:\\a', [session(1)]), project('D:\\b', [session(2)])];
    expect(groupSubfolders(list)).toEqual(list);
  });

  it('lifts a grandchild to the root, not to a folder that is itself grouped away', () => {
    const root = project('D:\\Coding\\app', [session(10)]);
    const mid = project('D:\\Coding\\app\\src-tauri', [session(20)]);
    const leaf = project('D:\\Coding\\app\\src-tauri\\tests', [session(30)]);

    const out = groupSubfolders([root, mid, leaf]);

    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(root.key);
    expect(out[0].sessions).toHaveLength(3);
  });

  it('groups a subfolder under the nearest listed ancestor, not the outermost', () => {
    const outer = project('D:\\Coding', [session(1)]);
    const inner = project('D:\\Coding\\app', [session(2)]);
    const leaf = project('D:\\Coding\\app\\src', [session(3)]);

    const out = groupSubfolders([outer, inner, leaf]);

    // `leaf` groups into `inner` by the nearest rule, but `inner` is itself grouped into
    // `outer`, so everything collapses to the outermost listed project.
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(outer.key);
    expect(out[0].sessions).toHaveLength(3);
  });

  it('never groups the Unknown project, which has no path to compare', () => {
    const unknown = project(null, [session(5)]);
    const real = project('D:\\Coding\\app', [session(6)]);

    const out = groupSubfolders([unknown, real]);

    expect(out).toHaveLength(2);
    expect(out.find((p) => p.path === null)?.sessions).toHaveLength(1);
  });

  it('does not group a sibling whose name merely starts with the same text', () => {
    const a = project('D:\\Coding\\app', [session(1)]);
    const b = project('D:\\Coding\\app-old', [session(2)]);
    expect(groupSubfolders([a, b])).toHaveLength(2);
  });
});

describe('subfolderLabel', () => {
  it('names the part below the project', () => {
    expect(subfolderLabel('D:\\Coding\\app', 'D:\\Coding\\app\\src-tauri')).toBe('src-tauri');
    expect(subfolderLabel('D:\\Coding\\app', 'D:/Coding/app/src/lib')).toBe('src\\lib');
  });

  it('is empty for the project directory itself, and for anything outside it', () => {
    expect(subfolderLabel('D:\\Coding\\app', 'D:\\Coding\\app')).toBe('');
    expect(subfolderLabel('D:\\Coding\\app', 'D:\\Coding\\app-old')).toBe('');
    expect(subfolderLabel('D:\\Coding\\app', 'D:\\Other')).toBe('');
    expect(subfolderLabel(null, 'D:\\Coding\\app\\src')).toBe('');
    expect(subfolderLabel('D:\\Coding\\app', null)).toBe('');
  });

  it('ignores the casing of the project path', () => {
    expect(subfolderLabel('d:\\coding\\app', 'D:\\Coding\\app\\src-tauri')).toBe('src-tauri');
  });
});
