const OUTPUT_CAP = 8 * 1024;

/** Long text keeps its start and its end, where a test run's summary and last failure are. */
export function clip(s: string, n = OUTPUT_CAP): string {
  if (s.length <= n) return s;
  const half = n / 2;
  return `${s.slice(0, half)}\n… ${s.slice(half, -half).split('\n').length - 1} lines omitted …\n${s.slice(-half)}`;
}

export function firstLine(s: string): string {
  const line = s.trim().split('\n')[0].trim();
  return line.length <= 200 ? line : line.slice(0, 200) + '…';
}
