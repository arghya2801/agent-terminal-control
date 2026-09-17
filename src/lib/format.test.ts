import { describe, expect, it } from 'vitest';
import { claudeTitle, formatMatches, relativeTime, shortenPath, usableTitle } from './format';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('collapses anything under a minute to "now"', () => {
    expect(relativeTime(NOW - 1000, NOW)).toBe('now');
    expect(relativeTime(NOW, NOW)).toBe('now');
  });

  it('steps through minutes, hours, days, weeks, years', () => {
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe('5m');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3h');
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe('2d');
    expect(relativeTime(NOW - 20 * DAY, NOW)).toBe('2w');
    expect(relativeTime(NOW - 400 * DAY, NOW)).toBe('1y');
  });

  it('does not render a negative age when clocks disagree', () => {
    // File mtimes can sit slightly in the future across filesystems.
    expect(relativeTime(NOW + 5000, NOW)).toBe('now');
  });

  it('renders nothing for a missing timestamp', () => {
    expect(relativeTime(0, NOW)).toBe('');
    expect(relativeTime(NaN, NOW)).toBe('');
  });
});

describe('shortenPath', () => {
  it('leaves short paths alone', () => {
    const p = String.raw`D:\Coding\p`;
    expect(shortenPath(p)).toBe(p);
  });

  it('keeps the drive and the leaf visible', () => {
    const long = String.raw`D:\Coding\some\very\deeply\nested\project\directory`;
    const out = shortenPath(long, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.startsWith('D:')).toBe(true);
    expect(out.endsWith('directory')).toBe(true);
    expect(out).toContain('…');
  });
});

describe('formatMatches', () => {
  it('shows position and total', () => {
    expect(formatMatches(2, 17, 'error')).toBe('3/17');
  });

  it('says so when nothing matched', () => {
    expect(formatMatches(-1, 0, 'zzz')).toBe('no results');
  });

  it('shows nothing at all for an empty query', () => {
    // An empty find bar should look idle, not like a failed search.
    expect(formatMatches(-1, 0, '')).toBe('');
  });

  it('falls back to the bare count while the index is unsettled', () => {
    // The addon reports -1 past its highlight limit.
    expect(formatMatches(-1, 1200, 'e')).toBe('1200');
  });
});

describe('usableTitle', () => {
  it('drops empty titles and executable paths', () => {
    expect(usableTitle('  ')).toBeNull();
    expect(usableTitle(String.raw`C:\Program Files\PowerShell\7\pwsh.exe`)).toBeNull();
    expect(usableTitle(String.raw`C:\WINDOWS\system32\cmd.EXE`)).toBeNull();
  });
  it('keeps real titles', () => {
    expect(usableTitle('✳ Fix copy in Claude Code')).toBe('✳ Fix copy in Claude Code');
  });
});

describe('claudeTitle', () => {
  it('reads an idle session and its name', () => {
    expect(claudeTitle('✳ atc-issue-backlog')).toEqual({ activity: 'idle', name: 'atc-issue-backlog' });
  });

  it('reads both working frames', () => {
    expect(claudeTitle('◐ fix the build')?.activity).toBe('working');
    expect(claudeTitle('◑ fix the build')).toEqual({ activity: 'working', name: 'fix the build' });
  });

  it('treats an older braille spinner as working', () => {
    expect(claudeTitle('⠐ Claude Code')?.activity).toBe('working');
  });

  it('ignores titles Claude did not set', () => {
    expect(claudeTitle(String.raw`C:\Program Files\PowerShell\7\pwsh.exe`)).toBeNull();
    expect(claudeTitle('vim notes.txt')).toBeNull();
    expect(claudeTitle('✳')).toBeNull();
  });
});
