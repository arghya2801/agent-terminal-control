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

/** The call the agent is waiting on: the newest one without a result, when only other
 *  calls follow it. Anything else after it (a reply, an interrupt) means it was let go. */
export function pendingCall(items: ChatItem[]): ChatItem | null {
  for (let i = items.length - 1; i >= 0 && items[i].kind === 'tool'; i--) {
    if (!items[i].done) return items[i];
  }
  return null;
}
