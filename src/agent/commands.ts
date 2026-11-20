import type { Command } from '../../sidecar/protocol';

export type Sigil = '/' | '$' | '@';

/** The command, skill or file being typed at `caret`: a `/name`, `$skill` or `@path` token
 *  anywhere. Null when the caret is not in one of `sigils`. */
export function typedCommand(text: string, caret: number, sigils: Sigil[]): { start: number; query: string; sigil: Sigil } | null {
  const before = text.slice(0, caret);
  for (const sigil of sigils) {
    const start = before.lastIndexOf(sigil);
    if (start < 0 || /\s/.test(before.slice(start)) || (start > 0 && !/\s/.test(before[start - 1]))) continue;
    return { start, query: before.slice(start + 1).toLowerCase(), sigil };
  }
  return null;
}

const subsequence = (text: string, q: string) => {
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i >= q.length;
};

/** Commands for the menu, those spelled with `sigil`: matching ones in `recent` first, most
 *  recent first, then names starting with the query, names containing it, names holding its
 *  letters in order, and descriptions containing it. */
export function matchCommands(commands: Command[], query: string, sigil: Sigil = '/', limit = 8, recent: string[] = []): Command[] {
  const name = (c: Command) => c.name.slice(1).toLowerCase();
  const used = (c: Command) => (recent.includes(c.name) ? recent.indexOf(c.name) : recent.length);
  const ranked = commands
    .filter((c) => c.name.startsWith(sigil))
    .map((c) => ({ c, used: used(c), rank: name(c).startsWith(query) ? 0 : name(c).includes(query) ? 1 : subsequence(name(c), query) ? 2 : c.description.toLowerCase().includes(query) ? 3 : 4 }))
    .filter((x) => x.rank < 4);
  return ranked.sort((a, b) => a.used - b.used || a.rank - b.rank).slice(0, limit).map((x) => x.c);
}

/** `recent` with `name` moved to the front. */
export const markUsed = (recent: string[], name: string) => [name, ...recent.filter((n) => n !== name)].slice(0, 20);
