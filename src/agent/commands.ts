import type { Command } from '../../sidecar/protocol';

export type Sigil = '/' | '$';

/** The command or skill being typed at `caret`: `/name` opening a message, or a `$name`
 *  token anywhere (Codex skills). Null when the caret is not in one of `sigils`. */
export function typedCommand(text: string, caret: number, sigils: Sigil[]): { start: number; query: string; sigil: Sigil } | null {
  const before = text.slice(0, caret);
  for (const sigil of sigils) {
    const start = sigil === '/' ? (before.startsWith('/') ? 0 : -1) : before.lastIndexOf('$');
    if (start < 0 || /\s/.test(before.slice(start)) || (start > 0 && !/\s/.test(before[start - 1]))) continue;
    return { start, query: before.slice(start + 1).toLowerCase(), sigil };
  }
  return null;
}

/** Commands for the menu, those spelled with `sigil`: names starting with the query first,
 *  then names containing it, then descriptions containing it. */
export function matchCommands(commands: Command[], query: string, sigil: Sigil = '/', limit = 8): Command[] {
  const name = (c: Command) => c.name.slice(1).toLowerCase();
  const ranked = commands
    .filter((c) => c.name.startsWith(sigil))
    .map((c) => ({ c, rank: name(c).startsWith(query) ? 0 : name(c).includes(query) ? 1 : c.description.toLowerCase().includes(query) ? 2 : 3 }))
    .filter((x) => x.rank < 3);
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map((x) => x.c);
}
