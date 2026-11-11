/** Find in a chat (#257): matches in the text on screen, painted with CSS highlights.
 *  Folded tool groups are not rendered, so they are not searched. */
let ranges: Range[] = [];
let index = -1;
let last = '';

function matches(root: Element, q: string): Range[] {
  const out: Range[] = [];
  const needle = q.toLowerCase();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement?.checkVisibility()) continue;
    const text = n.nodeValue!.toLowerCase();
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      const r = new Range();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

/** A new query starts at the first match on screen; the same one steps by `dir`. */
export function findInChat(container: Element, q: string, dir: 1 | -1): { index: number; count: number } {
  const list = container.querySelector('.list');
  ranges = list && q ? matches(list, q) : [];
  if (!list || !ranges.length) {
    clearChatFind();
    return { index: -1, count: 0 };
  }
  if (q !== last) {
    const top = list.getBoundingClientRect().top;
    index = ranges.findIndex((r) => r.getBoundingClientRect().top >= top);
    if (index < 0) index = ranges.length - 1;
  } else index = (index + dir + ranges.length) % ranges.length;
  last = q;
  CSS.highlights.set('chat-find', new Highlight(...ranges));
  CSS.highlights.set('chat-find-current', new Highlight(ranges[index]));
  ranges[index].startContainer.parentElement?.scrollIntoView({ block: 'center' });
  return { index, count: ranges.length };
}

export function clearChatFind() {
  CSS.highlights.delete('chat-find');
  CSS.highlights.delete('chat-find-current');
  last = '';
}
