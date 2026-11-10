import { describe, expect, it } from 'vitest';
import { tokens } from './highlight';

const kinds = (code: string, lang: string) => tokens(code, lang).filter((t) => t.kind).map((t) => [t.kind, t.text]);

describe('tokens', () => {
  it('colours keywords, strings, numbers and comments', () => {
    expect(kinds('const a = "x // y"; // note\nreturn 42', 'ts')).toEqual([
      ['keyword', 'const'], ['string', '"x // y"'], ['comment', '// note'], ['keyword', 'return'], ['number', '42'],
    ]);
  });

  it('uses # comments only where the language has them', () => {
    expect(kinds('x = 1 # hi', 'python')).toEqual([['number', '1'], ['comment', '# hi']]);
    expect(kinds('#include <a>', 'c')).toEqual([]);
  });

  it('keeps every character, in order', () => {
    const code = 'if (a) { b = `t${c}`; } /* d */';
    expect(tokens(code, 'js').map((t) => t.text).join('')).toBe(code);
  });

  it('leaves plain and unlabelled blocks alone', () => {
    expect(tokens('return 1', null)).toEqual([{ text: 'return 1', kind: null }]);
    expect(tokens('return 1', 'text')).toEqual([{ text: 'return 1', kind: null }]);
  });
});
