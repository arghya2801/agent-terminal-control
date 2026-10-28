import { describe, expect, it } from 'vitest';
import { activity, blocks, relativePaths, summarize, thoughtLine } from './work';
import type { ChatItem } from '../../sidecar/protocol';

const tool = (id: string, name: string, input = '', extra: Partial<ChatItem> = {}): ChatItem => ({ id, kind: 'tool', tool: name, input, done: true, ...extra });

describe('summarize', () => {
  it('says what a run of calls did, counting distinct edited files', () => {
    expect(summarize([tool('1', 'Read', 'a.ts'), tool('2', 'Read', 'b.ts'), tool('3', 'Bash', 'npm test')])).toBe('Read 2 files and ran 1 command');
    expect(summarize([tool('1', 'Edit', 'a.ts'), tool('2', 'Edit', 'a.ts'), tool('3', 'Grep', 'x'), tool('4', 'mcp.thing')])).toBe(
      'Changed 1 file, searched the code 1 time and used 1 tool',
    );
  });
});

describe('blocks', () => {
  it('folds two or more calls in a row, per agent, and leaves questions alone', () => {
    const steps: ChatItem[] = [
      tool('1', 'Read'),
      tool('2', 'Bash'),
      { id: 't', kind: 'assistant', text: 'ok' },
      tool('3', 'Read'),
      tool('4', 'AskUserQuestion'),
      tool('5', 'Read', '', { parent: 'task' }),
      tool('6', 'Read', '', { parent: 'task' }),
    ];
    expect(blocks(steps).map((b) => (b.kind === 'group' ? b.items.map((i) => i.id).join('+') : b.item.id))).toEqual(['1+2', 't', '3', '4', '5+6']);
  });
});

describe('relativePaths', () => {
  it('drops the workspace from paths with either slash, in any case', () => {
    expect(relativePaths('D:\\Coding\\app\\src\\a.ts', 'D:\\Coding\\app')).toBe('src\\a.ts');
    expect(relativePaths('cat d:/coding/app/b.ts d:/other/c.ts', 'D:\\Coding\\app\\')).toBe('cat b.ts d:/other/c.ts');
    expect(relativePaths('x', null)).toBe('x');
  });
});

describe('activity', () => {
  it('names the running call, the thought, or the reply', () => {
    expect(activity([tool('1', 'Bash', 'npm test', { done: false })], null)).toBe('Running npm test');
    expect(activity([{ id: 'x', kind: 'thinking', text: '**Checking the resize path**\nmore' }], null)).toBe('Checking the resize path');
    expect(activity([{ id: 'x', kind: 'assistant', text: 'Hi' }], null)).toBe('Writing');
    expect(activity([], null)).toBe('Thinking');
  });
  it('takes the first sentence of a thought without a heading', () => {
    expect(thoughtLine('The `fit` runs early. Then it resizes.')).toBe('The fit runs early.');
  });
});
