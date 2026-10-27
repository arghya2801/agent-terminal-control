/**
 * The chat view's copy of each session file: read once, then from where the last read
 * stopped whenever Go says the file was written. Raw state: every read replaces a chat
 * whole, so thousands of items never become deep proxies.
 */
import { listen } from '../lib/desktop';
import { transcriptRead } from '../lib/ipc';
import type { AgentProvider, ChatItem } from '../types';
import { merge } from './merge';

export interface Chat {
  items: ChatItem[];
  /** Older items a capped first read left out. */
  dropped: number;
  loaded: boolean;
  error: string | null;
}

let chats = $state.raw<Record<string, Chat>>({});
const cursors = new Map<string, { provider: AgentProvider; offset: number; last: string; busy: boolean; again: boolean }>();
let listening = false;

export function chatOf(file: string): Chat | undefined {
  return chats[file];
}

/** Start following a session file. Call from an effect: it writes state. */
export function follow(provider: AgentProvider, file: string) {
  if (cursors.has(file)) return;
  cursors.set(file, { provider, offset: 0, last: '', busy: false, again: false });
  chats = { ...chats, [file]: { items: [], dropped: 0, loaded: false, error: null } };
  if (!listening) {
    listening = true;
    void listen<string>('transcript://changed', (changed) => {
      if (cursors.has(changed)) void read(changed);
    });
  }
  void read(file);
}

/** One read at a time per file; writes that land during a read cause one more. */
async function read(file: string) {
  const c = cursors.get(file)!;
  if (c.busy) {
    c.again = true;
    return;
  }
  c.busy = true;
  try {
    do {
      c.again = false;
      const page = await transcriptRead(c.provider, file, c.offset, c.last);
      const was = chats[file];
      const fresh = page.reset || c.offset === 0;
      chats = {
        ...chats,
        [file]: { items: merge(fresh ? [] : was.items, page.items), dropped: fresh ? page.dropped : was.dropped, loaded: true, error: null },
      };
      c.offset = page.offset;
      c.last = page.last;
    } while (c.again);
  } catch (e) {
    chats = { ...chats, [file]: { ...chats[file], loaded: true, error: String(e) } };
  } finally {
    c.busy = false;
  }
}
