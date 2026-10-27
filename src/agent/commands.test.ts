import { describe, expect, it } from 'vitest';
import { matchCommands, typedCommand } from './commands';

const commands = [
  { name: 'compact', description: 'Clear history but keep a summary' },
  { name: 'ponytail:ponytail-review', description: 'Code review for over-engineering' },
  { name: 'review', description: 'Review a pull request' },
  { name: 'cost', description: 'Show the session cost' },
];

describe('typedCommand', () => {
  it('finds a slash command only at the start of a Claude message', () => {
    expect(typedCommand('/rev', 4, '/')).toEqual({ start: 0, query: 'rev' });
    expect(typedCommand('/review now', 11, '/')).toBeNull();
    expect(typedCommand('see /rev', 8, '/')).toBeNull();
  });

  it('finds a $skill token anywhere in a Codex message', () => {
    expect(typedCommand('use $cave', 9, '$')).toEqual({ start: 4, query: 'cave' });
    expect(typedCommand('costs $5', 8, '$')).toEqual({ start: 6, query: '5' });
    expect(typedCommand('a$b', 3, '$')).toBeNull();
  });
});

describe('matchCommands', () => {
  it('ranks prefix, then name, then description matches', () => {
    expect(matchCommands(commands, 'rev').map((c) => c.name)).toEqual(['review', 'ponytail:ponytail-review']);
    expect(matchCommands(commands, 'summary').map((c) => c.name)).toEqual(['compact']);
    expect(matchCommands(commands, '').length).toBe(4);
  });
});
