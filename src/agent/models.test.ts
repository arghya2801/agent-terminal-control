import { describe, expect, it } from 'vitest';
import { families, keptEffort } from './models';

const m = (id: string, label = id, efforts?: string[]) => ({ id, label, efforts });
const brief = (fs: ReturnType<typeof families>) => fs.map((f) => `${f.name} ${f.latest.id} [${f.older.map((o) => o.id).join(' ')}]`);

describe('families', () => {
  it('groups Claude by name, the alias as latest, older pinned versions newest first', () => {
    const claude = [
      m('default', 'Default (recommended)'),
      m('opus', 'Opus 5.5'),
      m('haiku', 'Haiku 5.5'),
      m('claude-haiku-4-5-20251001', 'Haiku 4.5'),
      m('claude-opus-4-8', 'Opus 4.8'),
      m('claude-opus-5', 'Opus 5'),
    ];
    expect(brief(families('claude', claude))).toEqual(['Opus opus [claude-opus-5 claude-opus-4-8]', 'Haiku haiku [claude-haiku-4-5-20251001]']);
    expect(families('claude', claude)[0].version).toBe('5.5');
  });

  it('groups Codex by the family in the id, the highest version as latest', () => {
    const codex = [m('gpt-6.1-sol'), m('gpt-6-astra'), m('gpt-6-sol'), m('gpt-6-luna'), m('gpt-5.6-sol'), m('gpt-5.6-luna')];
    expect(brief(families('codex', codex))).toEqual(['Sol gpt-6.1-sol [gpt-6-sol gpt-5.6-sol]', 'Astra gpt-6-astra []', 'Luna gpt-6-luna [gpt-5.6-luna]']);
  });
});

describe('keptEffort', () => {
  it('drops an effort the new model does not take', () => {
    expect(keptEffort('ultra', m('gpt-6-luna', 'Luna', ['low', 'max']))).toBeNull();
    expect(keptEffort('high', m('opus', 'Opus', ['low', 'high']))).toBe('high');
    expect(keptEffort('high', m('claude-haiku-4-5'))).toBeNull();
    expect(keptEffort(null, m('opus', 'Opus', ['low']))).toBeNull();
  });
});
