import type { ChatItem } from '../types';

/** Append a read's items, folding each result into the call it answers. A result whose
 *  call is not in the list (it fell before a capped read) is dropped. */
export function merge(items: ChatItem[], incoming: ChatItem[]): ChatItem[] {
  const out = [...items];
  for (const it of incoming) {
    if (it.kind !== 'result') {
      out.push(it);
      continue;
    }
    const i = out.findLastIndex((t) => t.kind === 'tool' && t.id === it.id);
    if (i >= 0) out[i] = { ...out[i], output: it.output, error: it.error, done: true };
  }
  return out;
}
