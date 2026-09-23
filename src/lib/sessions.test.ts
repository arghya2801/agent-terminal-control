import { describe, expect, it } from 'vitest';
import { resolveSessions, type TabRef } from './sessions';
import type { Project, SessionMeta, TabKey } from '../types';

const T0 = 1_000_000;

function session(id: string, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    provider: 'claude',
    file: `${id}.jsonl`,
    cwd: 'D:\\Coding\\app',
    gitBranch: null,
    label: id,
    labelSource: 'uuid',
    mtimeMs: T0,
    size: 0,
    ...over,
  };
}

function project(path: string, sessions: SessionMeta[]): Project {
  return {
    key: path.toLowerCase(),
    path,
    name: path.split('\\').pop()!,
    pinned: false,
    exists: true,
    lastActiveMs: T0,
    sessions,
  };
}

function claudeTab(over: Partial<TabRef> = {}): TabRef {
  return {
    key: 'claude:1' as TabKey,
    projectKey: 'd:\\coding\\app',
    cwd: 'D:\\Coding\\app',
    claudeName: null,
    startedAt: T0,
    ...over,
  };
}

describe('resolveSessions', () => {
  it('takes a resumed tab’s id straight from its key', () => {
    const p = project('D:\\Coding\\app', [session('aaa')]);
    const tabs = [{ ...claudeTab(), key: 'session:aaa' as TabKey }];
    expect(resolveSessions(tabs, [p]).get('session:aaa' as TabKey)).toBe('claude:aaa');
  });

  it('claims the session written since the tab opened, with no name to go on', () => {
    // The case the old name-matching could not handle: a brand-new session has neither
    // agentName nor aiTitle yet, so its label is nothing the title would ever match.
    const old = session('old', { mtimeMs: T0 - 5000, label: 'an older session' });
    const fresh = session('fresh', { mtimeMs: T0 + 500, label: '3f9c1a2b' });
    const p = project('D:\\Coding\\app', [old, fresh]);

    const got = resolveSessions([claudeTab()], [p]);

    expect(got.get('claude:1' as TabKey)).toBe('claude:fresh');
  });

  it('never claims a session that predates the tab', () => {
    const p = project('D:\\Coding\\app', [session('old', { mtimeMs: T0 - 1 })]);
    expect(resolveSessions([claudeTab()], [p]).has('claude:1' as TabKey)).toBe(false);
  });

  it('prefers an exact name match over recency', () => {
    const named = session('named', { mtimeMs: T0 + 10, label: 'my session' });
    const newer = session('newer', { mtimeMs: T0 + 9999, label: 'something else' });
    const p = project('D:\\Coding\\app', [named, newer]);

    const got = resolveSessions([claudeTab({ claudeName: 'my session' })], [p]);

    expect(got.get('claude:1' as TabKey)).toBe('claude:named');
  });

  it('still resolves when the title name matches nothing in the sidebar', () => {
    // The real failure: the label came from `agentName` while the title shows `aiTitle`.
    const s = session('x', { mtimeMs: T0 + 100, label: 'atc-copy-paste-fixes' });
    const p = project('D:\\Coding\\app', [s]);

    const tab = claudeTab({ claudeName: 'ATC application feature requests and bugs' });

    expect(resolveSessions([tab], [p]).get('claude:1' as TabKey)).toBe('claude:x');
  });

  it('leaves multiple equally plausible launches unbound', () => {
    const a = session('a', { mtimeMs: T0 + 100 });
    const b = session('b', { mtimeMs: T0 + 200 });
    const p = project('D:\\Coding\\app', [a, b]);

    const got = resolveSessions(
      [claudeTab({ key: 'claude:1' as TabKey }), claudeTab({ key: 'claude:2' as TabKey })],
      [p],
    );

    const ids = [got.get('claude:1' as TabKey), got.get('claude:2' as TabKey)];
    expect(ids).toEqual([undefined, undefined]);
  });

  it('does not steal a session a resumed tab already owns', () => {
    const s = session('shared', { mtimeMs: T0 + 100 });
    const p = project('D:\\Coding\\app', [s]);

    const got = resolveSessions(
      [{ ...claudeTab(), key: 'session:shared' as TabKey }, claudeTab()],
      [p],
    );

    expect(got.get('session:shared' as TabKey)).toBe('claude:shared');
    expect(got.has('claude:1' as TabKey)).toBe(false);
  });

  it('matches on the directory, not the project row', () => {
    // A scratch-pad tab has no project key at all; its cwd is the only key it has.
    const s = session('scratch', { cwd: 'C:\\scratch', mtimeMs: T0 + 10, label: 'x' });
    const p = project('C:\\scratch', [s]);

    const tab = claudeTab({ projectKey: null, cwd: 'C:/scratch/' });

    expect(resolveSessions([tab], [p]).get('claude:1' as TabKey)).toBe('claude:scratch');
  });

  it('does not claim a session from a sibling directory', () => {
    const other = session('other', { cwd: 'D:\\Coding\\app-old', mtimeMs: T0 + 100 });
    const p = project('D:\\Coding\\app-old', [other]);
    expect(resolveSessions([claudeTab()], [p]).has('claude:1' as TabKey)).toBe(false);
  });

  it('uses the tab project when a session has no recorded cwd', () => {
    const s = session('nodir', { cwd: null, mtimeMs: T0 + 10 });
    const p = project('D:\\Coding\\app', [s]);
    const tab = claudeTab({ cwd: null });
    expect(resolveSessions([tab], [p]).get('claude:1' as TabKey)).toBe('claude:nodir');
  });

  it('uses the project path when a session has no cwd or matching project key', () => {
    const s = session('nodir', { cwd: null, mtimeMs: T0 + 10 });
    const p = project('D:\\Coding\\app', [s]);
    const tab = claudeTab({ projectKey: null, cwd: 'D:/Coding/app' });
    expect(resolveSessions([tab], [p]).get('claude:1' as TabKey)).toBe('claude:nodir');
  });

  it('resolves overlapping launch windows when only one assignment fits', () => {
    const first = session('first', { mtimeMs: T0 + 100 });
    const second = session('second', { mtimeMs: T0 + 900 });
    const p = project('D:\\Coding\\app', [first, second]);

    const got = resolveSessions(
      [
        claudeTab({ key: 'claude:2' as TabKey, startedAt: T0 + 500 }),
        claudeTab({ key: 'claude:1' as TabKey, startedAt: T0 }),
      ],
      [p],
    );

    expect(got.get('claude:1' as TabKey)).toBe('claude:first');
    expect(got.get('claude:2' as TabKey)).toBe('claude:second');
  });
  it('does not give one session to two simultaneous launches', () => {
    const p = project('D:\\Coding\\app', [session('only', { mtimeMs: T0 + 100 })]);
    const tabs = [claudeTab({ key: 'claude:1' as TabKey }), claudeTab({ key: 'claude:2' as TabKey })];
    expect(resolveSessions(tabs, [p]).size).toBe(0);
  });

  it('returns nothing for a plain shell tab', () => {
    const p = project('D:\\Coding\\app', [session('a', { mtimeMs: T0 + 100 })]);
    const tabs = [{ ...claudeTab(), key: 'plain:1' as TabKey }];
    expect(resolveSessions(tabs, [p]).size).toBe(0);
  });
});


it('uses provider and Codex creation time, excluding old sessions with new writes', () => {
  const p = project('D:\\Coding\\app', [
    session('same', { provider: 'claude', mtimeMs: T0 + 100 }),
    session('old', { provider: 'codex', createdAtMs: T0 - 100, mtimeMs: T0 + 100 }),
    session('same', { provider: 'codex', createdAtMs: T0 + 100 }),
  ]);
  const tab = claudeTab({ key: 'agent:codex:1', provider: 'codex' });
  expect(resolveSessions([tab], [p]).get(tab.key)).toBe('codex:same');
  expect(resolveSessions([{ ...tab, boundSession: 'codex:same' }], []) .get(tab.key)).toBe('codex:same');
});

it('pairs Codex tabs when both new conversations appear in one index update', () => {
  const p = project('D:\\Coding\\app', [
    session('first', { provider: 'codex', createdAtMs: T0 + 100 }),
    session('second', { provider: 'codex', createdAtMs: T0 + 900 }),
  ]);
  const first = claudeTab({ key: 'agent:codex:1', provider: 'codex' });
  const second = claudeTab({ key: 'agent:codex:2', provider: 'codex', startedAt: T0 + 500 });
  const got = resolveSessions([first, second], [p]);
  expect(got.get(first.key)).toBe('codex:first');
  expect(got.get(second.key)).toBe('codex:second');
});

it('excludes conversations already present at launch even when they are updated', () => {
  const p = project('D:\\Coding\\app', [session('old', { mtimeMs: T0 + 100 })]);
  expect(resolveSessions([claudeTab({ existingSessions: ['claude:old'] })], [p]).size).toBe(0);
});
