import { describe, expect, it } from 'vitest';
import { renderMarkdown as md, toggleCheckbox } from './markdown';

describe('renderMarkdown', () => {
  it('renders the block types notes use', () => {
    expect(md('# Title\n\nSome text')).toBe('<h1>Title</h1><p>Some text</p>');
    expect(md('- a\n- b\n\n1. one\n2) two')).toBe('<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>');
    expect(md('> quoted')).toBe('<blockquote>quoted</blockquote>');
    expect(md('- [ ] todo\n- [x] done')).toBe(
      '<ul><li class="check"><input type="checkbox" data-box="0"> todo</li>' +
        '<li class="check"><input type="checkbox" data-box="1" checked> done</li></ul>',
    );
    expect(md('- [ ] task\n  its note\nafter')).toBe(
      '<ul><li class="check"><input type="checkbox" data-box="0"> task</li><li class="sub">its note</li></ul><p>after</p>',
    );
  });

  it('flips the nth checkbox in the source, skipping fenced code', () => {
    const src = '- [ ] a\n```\n- [ ] not a box\n```\n  * [X] b';
    expect(toggleCheckbox(src, 0)).toBe(src.replace('- [ ] a', '- [x] a'));
    expect(toggleCheckbox(src, 1)).toBe(src.replace('* [X] b', '* [ ] b'));
    expect(toggleCheckbox(src, 2)).toBe(src);
    // The numbering matches what renderMarkdown puts in data-box.
    expect(md(src)).toContain('data-box="1" checked> b');
  });

  it('renders inline code, bold, italic and links', () => {
    expect(md('**b** *i* `c` [x](https://a.b/c?d=1)')).toBe(
      '<p><strong>b</strong> <em>i</em> <code>c</code> ' +
        '<a href="https://a.b/c?d=1" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
  });

  it('keeps emphasis markers inside a URL out of the href (#92)', () => {
    expect(md('[doc](https://a.b/x/*draft*/y) and **[b](https://a.b/**z**)**')).toBe(
      '<p><a href="https://a.b/x/*draft*/y" target="_blank" rel="noopener noreferrer">doc</a> and ' +
        '<strong><a href="https://a.b/**z**" target="_blank" rel="noopener noreferrer">b</a></strong></p>',
    );
    expect(md('[*it*](https://a.b)')).toBe(
      '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer"><em>it</em></a></p>',
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
