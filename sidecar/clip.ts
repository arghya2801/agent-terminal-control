const OUTPUT_CAP = 8 * 1024;

/** Long text keeps its start and its end, where a test run's summary and last failure are.
 *  The marker between them adds two newlines; `clippedLines` takes them back out. */
export function clip(s: string, n = OUTPUT_CAP): string {
  if (s.length <= n) return s;
  const half = n / 2;
  const cut = s.slice(half, -half);
  const lines = cut.split('\n').length - 1;
  return `${s.slice(0, half)}\n… ${lines ? `${lines} lines` : `${cut.length} characters`} omitted …\n${s.slice(-half)}`;
}

/** How many lines `clip`'s input had, from its output. */
export function clippedLines(out: string): number {
  if (!out) return 0;
  const m = /\n… (?:(\d+) lines|\d+ characters) omitted …\n/.exec(out);
  return out.split('\n').length + (m ? Number(m[1] ?? 0) - 2 : 0);
}

export function firstLine(s: string): string {
  const line = s.trim().split('\n')[0].trim();
  return line.length <= 200 ? line : line.slice(0, 200) + '…';
}
