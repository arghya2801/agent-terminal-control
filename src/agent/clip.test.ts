import { describe, expect, it } from 'vitest';
import { clip, firstLine } from '../../sidecar/events';

describe('clip', () => {
  it('keeps the start and the end of long output, and says how much it left out', () => {
    const out = clip(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 80);
    expect(out.startsWith('line 0\n')).toBe(true);
    expect(out.endsWith('line 99')).toBe(true);
    expect(out).toMatch(/\n… \d+ lines omitted …\n/);
  });
  it('leaves short text and first lines alone', () => {
    expect(clip('ok')).toBe('ok');
    expect(firstLine('  npm test\nmore')).toBe('npm test');
  });
});
