import { describe, expect, it } from 'vitest';
import { projectKey, samePath } from './paths';

describe('projectKey', () => {
  it('ignores case, separator style and a trailing separator', () => {
    const want = 'd:\\coding\\app';
    expect(projectKey('D:\\Coding\\app')).toBe(want);
    expect(projectKey('D:/Coding/app')).toBe(want);
    expect(projectKey('D:\\Coding\\app\\')).toBe(want);
  });

  it('trims a drive root the way the Rust key does', () => {
    expect(projectKey('C:\\')).toBe('c:');
    expect(projectKey('\\')).toBe('\\');
  });

  it('compares two spellings of one directory as equal', () => {
    expect(samePath('D:/Coding/app/', 'd:\\coding\\app')).toBe(true);
    expect(samePath('D:\\Coding\\app', 'D:\\Coding\\other')).toBe(false);
  });
});
