import { describe, expect, it } from 'vitest';
import { merge } from './merge';
import type { ChatItem } from '../types';

const tool = (id: string): ChatItem => ({ kind: 'tool', id, tool: 'Bash', at: 0 });
const result = (id: string, output: string, error = false): ChatItem => ({ kind: 'result', id, output, error, at: 0 });

describe('merge', () => {
  it('folds a result into its call, across reads', () => {
    const first = merge([], [{ kind: 'user', text: 'hi', at: 0 }, tool('a'), tool('b')]);
    const next = merge(first, [result('b', 'two', true), result('a', 'one'), { kind: 'assistant', text: 'done', at: 0 }]);
    expect(next.map((i) => [i.kind, i.output, i.error, i.done])).toEqual([
      ['user', undefined, undefined, undefined],
      ['tool', 'one', false, true],
      ['tool', 'two', true, true],
      ['assistant', undefined, undefined, undefined],
    ]);
    expect(first[1].done).toBeUndefined();
  });

  it('drops a result whose call it never saw', () => {
    expect(merge([tool('a')], [result('x', 'lost')])).toEqual([tool('a')]);
  });
});
