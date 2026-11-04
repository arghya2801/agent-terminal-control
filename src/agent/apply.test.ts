import { describe, expect, it } from 'vitest';
import { apply, emptyState, peek } from './apply';
import type { AgentEvent } from '../../sidecar/protocol';

// The events a real Haiku turn produced: a streamed tool call, its result, a streamed reply.
const turn: AgentEvent[] = [
  { t: 'item', item: { id: 'you1', kind: 'user', text: 'run node --version' } },
  { t: 'working', on: true },
  { t: 'session', id: 's1' },
  { t: 'item', item: { id: 'm1:0', kind: 'thinking', text: '', parent: null } },
  { t: 'item', item: { id: 't1', kind: 'tool', tool: 'Bash', input: '', parent: null } },
  { t: 'progress', id: 't1', seconds: 2 },
  { t: 'item', item: { id: 't1', kind: 'tool', tool: 'Bash', input: 'node --version', body: 'node --version', parent: null } },
  { t: 'result', id: 't1', output: 'v24.13.1', error: false },
  { t: 'item', item: { id: 'm2:0', kind: 'assistant', text: '', parent: null } },
  { t: 'delta', id: 'm2:0', kind: 'assistant', text: 'v24' },
  { t: 'delta', id: 'm2:0', kind: 'assistant', text: '.13.1' },
  { t: 'item', item: { id: 'm2:0', kind: 'assistant', text: 'v24.13.1', parent: null } },
  { t: 'working', on: false },
  { t: 'item', item: { id: 'r1', kind: 'turn', durationMs: 5825, costUsd: 0.0036 } },
];

describe('apply', () => {
  it('lands drafts, finals and results on the same items', () => {
    const s = emptyState();
    for (const ev of turn) apply(s, ev, 1000);
    expect(s.items.map((i) => [i.id, i.kind, i.text ?? i.input])).toEqual([
      ['you1', 'user', 'run node --version'],
      ['m1:0', 'thinking', ''],
      ['t1', 'tool', 'node --version'],
      ['m2:0', 'assistant', 'v24.13.1'],
      ['r1', 'turn', undefined],
    ]);
    expect(s.items[2]).toMatchObject({ output: 'v24.13.1', done: true, seconds: 2 });
    expect([s.sessionId, s.working, s.since]).toEqual(['s1', false, 1000]);
    expect(peek(s)).toEqual(['v24.13.1']);
  });

  it('keeps streamed text until the final block replaces it, and appends live output', () => {
    const s = emptyState();
    apply(s, { t: 'delta', id: 'x', kind: 'assistant', text: 'Hel' });
    apply(s, { t: 'delta', id: 'x', kind: 'assistant', text: 'lo' });
    expect(s.items[0].text).toBe('Hello');
    apply(s, { t: 'item', item: { id: 'c', kind: 'tool', tool: 'Shell', input: 'ls' } });
    apply(s, { t: 'output', id: 'c', text: 'a\n' });
    apply(s, { t: 'output', id: 'c', text: 'b\n' });
    expect(s.items[1].output).toBe('a\nb\n');
  });

  it('tracks requests and clears them when the session exits', () => {
    const s = emptyState();
    apply(s, { t: 'request', request: { id: 'r1', kind: 'permission', tool: 'Write', input: 'a.txt' } });
    apply(s, { t: 'request', request: { id: 'r2', kind: 'plan', tool: 'ExitPlanMode', input: 'Plan' } });
    apply(s, { t: 'resolved', id: 'r1' });
    expect(s.requests.map((r) => r.id)).toEqual(['r2']);
    apply(s, { t: 'exit', message: 'Claude exited' });
    expect([s.exited, s.requests.length, s.items.at(-1)?.text]).toEqual([true, 0, 'Claude exited']);
  });

  it('keeps only the end of a long running output, and says it was cut', () => {
    const s = emptyState();
    apply(s, { t: 'item', item: { id: 'c', kind: 'tool', tool: 'Bash', input: 'npm test' } });
    for (let i = 0; i < 2000; i++) apply(s, { t: 'output', id: 'c', text: `line ${i}\n` });
    const out = s.items[0].output!;
    expect(out.startsWith('[earlier output cut]\n')).toBe(true);
    expect(out.length).toBeLessThan(8300);
    expect(out.endsWith('line 1999\n')).toBe(true);
  });

  it('marks a resumed session dormant until its CLI is ready', () => {
    const s = emptyState();
    apply(s, { t: 'dormant' });
    expect([s.dormant, s.ready]).toEqual([true, false]);
    apply(s, { t: 'ready', commands: [], models: [], modes: [] });
    expect([s.dormant, s.ready]).toEqual([false, true]);
  });

  it('drops a rewound prompt and everything after it', () => {
    const s = emptyState();
    for (const ev of turn) apply(s, ev);
    apply(s, { t: 'item', item: { id: 'you2', kind: 'user', text: 'again' } });
    apply(s, { t: 'item', item: { id: 'm3:0', kind: 'assistant', text: 'v24' } });
    apply(s, { t: 'rewound', to: 'you2' });
    expect(s.items.at(-1)?.id).toBe('r1');
  });
});
