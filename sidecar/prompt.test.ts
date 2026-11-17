import { describe, expect, it } from 'vitest';
import { promptOf } from './claude.ts';

describe('promptOf', () => {
  it('shows the summary after a compaction as a done Compact step', () => {
    const text = 'This session is being continued from a previous conversation that ran out of context.\n\nSummary: ...';
    expect(promptOf(text)).toEqual({ t: 'item', item: { id: '', kind: 'tool', tool: 'Compact', input: 'Summary of the earlier conversation', body: text, done: true } });
  });

  it('keeps an ordinary message as the user said it', () => {
    expect(promptOf('fix the bug')).toEqual({ t: 'item', item: { id: '', kind: 'user', text: 'fix the bug' } });
  });
});
