import { expect, it } from 'vitest';
import { migrateSessionNames, sessionKey } from './agents';
import { parseSavedTabs } from './restore';

it('keeps identical native IDs separate and preserves explicit names during migration', () => {
  expect(sessionKey({ provider: 'codex', id: 'same' })).toBe('codex:same');
  expect(migrateSessionNames({ same: 'legacy', 'claude:same': 'new', 'codex:same': 'Codex' }))
    .toEqual({ 'claude:same': 'new', 'codex:same': 'Codex' });
});

it('restores legacy sessions as Claude and keeps Codex launches and selection', () => {
  const saved = parseSavedTabs(JSON.stringify({ tabs: [
    { kind: 'session', sessionId: 'same', cwd: 'D:\\p', customTitle: 'Legacy' },
    { kind: 'agent', provider: 'codex', cwd: 'D:\\p', customTitle: 'Fresh' },
  ], active: 1 }));
  expect(saved?.tabs[0]).toMatchObject({ provider: 'claude', customTitle: 'Legacy' });
  expect(saved?.tabs[1]).toMatchObject({ provider: 'codex', kind: 'agent', customTitle: 'Fresh' });
  expect(saved?.active).toBe(1);
});
