import { describe, expect, it } from 'vitest';
import { matchCommands, typedCommand } from './commands';

const commands = [
  { name: '/compact', description: 'Clear history but keep a summary' },
  { name: '/ponytail:ponytail-review', description: 'Code review for over-engineering' },
  { name: '/review', description: 'Review a pull request' },
  { name: '/cost', description: 'Show the session cost' },
  { name: '$caveman', description: 'Fewer tokens' },
];

describe('typedCommand', () => {
  it('finds a slash command only at the start of a message', () => {
    expect(typedCommand('/rev', 4, ['/'])).toEqual({ start: 0, query: 'rev', sigil: '/' });
    expect(typedCommand('/review now', 11, ['/'])).toBeNull();
    expect(typedCommand('see /rev', 8, ['/'])).toBeNull();
  });

  it('finds a $skill token anywhere when skills are on offer', () => {
    expect(typedCommand('use $cave', 9, ['/', '$'])).toEqual({ start: 4, query: 'cave', sigil: '$' });
    expect(typedCommand('use $cave', 9, ['/'])).toBeNull();
    expect(typedCommand('a$b', 3, ['$'])).toBeNull();
  });

  it('finds an @file token anywhere, but not inside an address', () => {
    expect(typedCommand('read @src/ap', 12, ['/', '@'])).toEqual({ start: 5, query: 'src/ap', sigil: '@' });
    expect(typedCommand('mail a@b', 8, ['@'])).toBeNull();
  });
});

describe('matchCommands', () => {
  it('ranks prefix, then name, then description matches, per sigil', () => {
    expect(matchCommands(commands, 'rev').map((c) => c.name)).toEqual(['/review', '/ponytail:ponytail-review']);
    expect(matchCommands(commands, 'summary').map((c) => c.name)).toEqual(['/compact']);
    expect(matchCommands(commands, '').length).toBe(4);
    expect(matchCommands(commands, 'cave', '$').map((c) => c.name)).toEqual(['$caveman']);
  });
});
