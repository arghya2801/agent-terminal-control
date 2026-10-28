import { describe, expect, it } from 'vitest';
import { keptEffort, olderModels } from './models';

const m = (id: string, efforts?: string[]) => ({ id, label: id, efforts });

describe('olderModels', () => {
  it('folds Claude versions pinned by id', () => {
    expect(olderModels('claude', [m('default'), m('opus'), m('claude-opus-4-8'), m('claude-haiku-4-5-20251001')]).map((x) => x.id)).toEqual([
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
    ]);
  });
  it('folds Codex models of an older major version', () => {
    expect(olderModels('codex', [m('gpt-6.1-sol'), m('gpt-6-astra'), m('gpt-5.6-sol'), m('gpt-5.6-luna')]).map((x) => x.id)).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    expect(olderModels('codex', [m('o4')])).toEqual([]);
  });
});

describe('keptEffort', () => {
  it('drops an effort the new model does not take', () => {
    expect(keptEffort('ultra', m('gpt-6-luna', ['low', 'max']))).toBeNull();
    expect(keptEffort('high', m('opus', ['low', 'high']))).toBe('high');
    expect(keptEffort('high', m('claude-haiku-4-5'))).toBeNull();
    expect(keptEffort(null, m('opus', ['low']))).toBeNull();
  });
});
