import { describe, expect, it } from 'vitest';
import { localPath } from './links';

describe('localPath', () => {
  it('finds local Windows paths', () => {
    expect(localPath('C:\\code\\a.md')).toBe('C:\\code\\a.md');
    expect(localPath('C:/code/a.md')).toBe('C:/code/a.md');
    expect(localPath('file:///C:/my%20code/a.md')).toBe('C:\\my code\\a.md');
  });
  it('leaves web links and other schemes alone', () => {
    expect(localPath('https://example.com')).toBeNull();
    expect(localPath('file://server/share/a.md')).toBeNull();
    expect(localPath('mailto:a@b.c')).toBeNull();
  });
});
