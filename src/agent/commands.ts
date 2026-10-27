import type { Command } from '../../sidecar/protocol';

/** The command or skill being typed at `caret`: `/name` opening a Claude message, or a
 *  `$name` token anywhere for Codex. Null when the caret is not in one. */
export function typedCommand(text: string, caret: number, sigil: '/' | '$'): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = sigil === '/' ? (before.startsWith('/') ? 0 : -1) : before.lastIndexOf('$');
  if (start < 0 || /\s/.test(before.slice(start)) || (start > 0 && !/\s/.test(before[start - 1]))) return null;
  return { start, query: before.slice(start + 1).toLowerCase() };
}

/** Commands for the menu: names starting with the query first, then names containing it,
 *  then descriptions containing it. */
export function matchCommands(commands: Command[], query: string, limit = 8): Command[] {
  const name = (c: Command) => c.name.replace(/^\$/, '').toLowerCase();
  const ranked = commands
    .map((c) => ({ c, rank: name(c).startsWith(query) ? 0 : name(c).includes(query) ? 1 : c.description.toLowerCase().includes(query) ? 2 : 3 }))
    .filter((x) => x.rank < 3);
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map((x) => x.c);
}
