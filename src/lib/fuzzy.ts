/**
 * How well `query` matches `text`, for the command palette: higher is better, null when
 * the query's letters do not all appear in order. A plain substring beats a scattered
 * match, an earlier one beats a later one, and letters that start a word count extra.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const startsWord = (i: number) => i === 0 || /[\s\-_/.\\:]/.test(t[i - 1]);
  const at = t.indexOf(q);
  if (at !== -1) return 1000 - at + (startsWord(at) ? 100 : 0);
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    const j = t.indexOf(ch, from);
    if (j === -1) return null;
    score += (j === last + 1 ? 5 : 1) + (startsWord(j) ? 8 : 0);
    last = j;
    from = j + 1;
  }
  return score;
}
