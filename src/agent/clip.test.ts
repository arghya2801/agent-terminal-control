import { describe, expect, it } from 'vitest';
import { clip, clippedLines, firstLine } from '../../sidecar/clip';

describe('clip', () => {
  it('keeps the start and the end of long output, and says how much it left out', () => {
    const out = clip(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 80);
    expect(out.startsWith('line 0\n')).toBe(true);
    expect(out.endsWith('line 99')).toBe(true);
    expect(out).toMatch(/\n… \d+ lines omitted …\n/);
  });
  it('counts the lines the output had, not the marker', () => {
    const text = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
    expect(clippedLines(clip(text))).toBe(5001);
    expect(clippedLines('a\nb')).toBe(2);
    expect(clippedLines('')).toBe(0);
  });
  it('says characters when the cut falls inside one line', () => {
    const out = clip('x'.repeat(9000));
    expect(out).toMatch(/… 808 characters omitted …/);
    expect(clippedLines(out)).toBe(1);
  });
  it('leaves short text and first lines alone', () => {
    expect(clip('ok')).toBe('ok');
    expect(firstLine('  npm test\nmore')).toBe('npm test');
  });
});
