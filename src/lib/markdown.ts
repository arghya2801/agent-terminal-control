/**
 * Enough Markdown for task notes: headings, lists, `- [ ]` boxes, quotes, fences, inline
 * code, bold, italic and http(s) links. Not spec-compliant and does not need to be.
 *
 * The source is escaped before any tag is added, so the output is safe for `{@html}`:
 * every tag in it comes from this function, and links only ever carry an http(s) URL.
 */

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(s: string): string {
  // Code spans first, parked so bold/italic/link rules cannot reach inside them.
  const codes: string[] = [];
  return s
    .replace(/`([^`]+)`/g, (_, c) => `\u0000C${codes.push(`<code>${c}</code>`) - 1}\u0000`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function renderMarkdown(src: string): string {
  const fences: string[] = [];
  const text = escape(src).replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) =>
    `\n\u0000F${fences.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`) - 1}\u0000\n`,
  );

  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const open = (kind: 'ul' | 'ol') => {
    if (list === kind) return;
    close();
    out.push(`<${kind}>`);
    list = kind;
  };

  for (const line of text.split('\n')) {
    const raw = line.trim();
    let m: RegExpMatchArray | null;
    if (!raw) {
      close();
    } else if (/^\u0000F\d+\u0000$/.test(raw)) {
      close();
      out.push(raw);
    } else if ((m = raw.match(/^(#{1,3})\s+(.*)$/))) {
      close();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = raw.match(/^&gt;\s?(.*)$/))) {
      close();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if ((m = raw.match(/^[-*]\s+(.*)$/))) {
      open('ul');
      const box = m[1].match(/^\[( |x|X)\]\s*(.*)$/);
      out.push(
        box
          ? `<li class="check"><input type="checkbox" disabled${box[1] === ' ' ? '' : ' checked'}> ${inline(box[2])}</li>`
          : `<li>${inline(m[1])}</li>`,
      );
    } else if ((m = raw.match(/^\d+[.)]\s+(.*)$/))) {
      open('ol');
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      close();
      out.push(`<p>${inline(raw)}</p>`);
    }
  }
  close();
  return out.join('').replace(/\u0000F(\d+)\u0000/g, (_, i) => fences[Number(i)]);
}
