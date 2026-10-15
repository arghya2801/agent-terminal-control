import { describe, expect, it } from 'vitest';
import { nextWaiting, peekLine, triageOrder } from './triage';

const tab = (key: string, mark: Parameters<typeof triageOrder>[0][0]['mark'], since: number) => ({ key, mark, since });

describe('triageOrder', () => {
  it('puts blocked agents first, longest waiting first', () => {
    const order = triageOrder([tab('w', 'working', 1), tab('i', 'idle', 5), tab('a2', 'attention', 9), tab('a1', 'attention', 3), tab('x', 'exited', 0)]);
    expect(order.map((t) => t.key)).toEqual(['a1', 'a2', 'i', 'w', 'x']);
  });
});

describe('nextWaiting', () => {
  it('skips the tab on screen and agents that are still working', () => {
    const tabs = [tab('a', 'attention', 1), tab('w', 'working', 0), tab('i', 'idle', 2)];
    expect(nextWaiting(tabs, 'a')?.key).toBe('i');
    expect(nextWaiting([tab('w', 'working', 0)], null)).toBeNull();
  });
});

describe('peekLine', () => {
  it('reads past Claude Code chrome to the question', () => {
    const screen = [
      ' Do you want to make this edit to app.go?',
      ' ❯ 1. Yes',
      '╭──────────────────────────╮',
      '│ >                        │',
      '╰──────────────────────────╯',
      '  ? for shortcuts',
      '',
    ];
    expect(peekLine(screen)).toBe('❯ 1. Yes');
  });

  it('is null for an empty screen', () => {
    expect(peekLine(['', '──────', ' > '])).toBeNull();
  });
});
