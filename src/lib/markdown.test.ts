import { describe, expect, it } from 'vitest';
import { renderMarkdown as md } from './markdown';

describe('renderMarkdown', () => {
  it('renders the block types notes use', () => {
    expect(md('# Title\n\nSome text')).toBe('<h1>Title</h1><p>Some text</p>');
    expect(md('- a\n- b\n\n1. one\n2) two')).toBe('<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>');
    expect(md('> quoted')).toBe('<blockquote>quoted</blockquote>');
    expect(md('- [ ] todo\n- [x] done')).toBe(
      '<ul><li class="check"><input type="checkbox" disabled> todo</li>' +
        '<li class="check"><input type="checkbox" disabled checked> done</li></ul>',
    );
  });

  it('renders inline code, bold, italic and links', () => {
    expect(md('**b** *i* `c` [x](https://a.b/c?d=1)')).toBe(
      '<p><strong>b</strong> <em>i</em> <code>c</code> ' +
        '<a href="https://a.b/c?d=1" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
  });

  it('leaves code spans and fences literal', () => {
    expect(md('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
    expect(md('```ts\nconst a = 1;\n# not a heading\n```')).toBe(
      '<pre><code>const a = 1;\n# not a heading</code></pre>',
    );
  });

  it('escapes HTML everywhere, including inside fences and link text', () => {
    expect(md('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(md('```\n<img onerror=x>\n```')).toBe('<pre><code>&lt;img onerror=x&gt;</code></pre>');
    expect(md('[<b>](https://x.y)')).toContain('>&lt;b&gt;</a>');
  });

  it('never links anything but http(s), and cannot break out of the attribute', () => {
    expect(md('[x](javascript:alert(1))')).not.toContain('<a');
    expect(md('[x](https://a.b/"onmouseover="y)')).not.toMatch(/href="[^"]*"on/);
  });

  it('keeps an empty note empty', () => {
    expect(md('')).toBe('');
    expect(md('  \n ')).toBe('');
  });
});
