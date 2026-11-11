import { describe, expect, it } from 'vitest';
import { nextWaiting, triageGroup, triageOrder } from './triage';

const tab = (key: string, mark: Parameters<typeof triageOrder>[0][0]['mark'], since: number) => ({ key, mark, since });

describe('triageOrder', () => {
  it('puts blocked agents first, the one that stopped most recently first', () => {
    const order = triageOrder([tab('w', 'working', 1), tab('i', 'idle', 5), tab('a2', 'attention', 9), tab('a1', 'attention', 3), tab('x', 'exited', 0)]);
    expect(order.map((t) => t.key)).toEqual(['a2', 'i', 'a1', 'w', 'x']);
  });

  it('moves done agents below shells and skips them when jumping', () => {
    const tabs = [{ ...tab('d', 'idle', 0), done: true }, tab('s', 'open', 1), tab('x', 'exited', 0), tab('i', 'idle', 5)];
    expect(triageOrder(tabs).map((t) => t.key)).toEqual(['i', 's', 'd', 'x']);
    expect(nextWaiting(tabs, 'i')).toBeNull();
    expect(triageGroup('idle', true)).toBe('Done');
  });
});

describe('nextWaiting', () => {
  it('skips the tab on screen and agents that are still working', () => {
    const tabs = [tab('a', 'attention', 1), tab('w', 'working', 0), tab('i', 'idle', 2)];
    expect(nextWaiting(tabs, 'a')?.key).toBe('i');
    expect(nextWaiting([tab('new', 'idle', 9), tab('old', 'attention', 3)], null)?.key).toBe('old');
    expect(nextWaiting([tab('w', 'working', 0)], null)).toBeNull();
  });
});

describe('triageGroup', () => {
  it('puts every blocked state under one heading', () => {
    expect(['attention', 'interrupted', 'idle', 'working', 'open', 'exited'].map((m) => triageGroup(m as never)))
      .toEqual(['Waiting on you', 'Waiting on you', 'Waiting on you', 'Working', 'Shells', 'Exited']);
  });
});
