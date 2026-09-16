import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { decodeOsc52 } from './osc52';

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('decodeOsc52', () => {
  it('decodes the clipboard selection', () => {
    expect(decodeOsc52(`c;${enc('hello')}`)).toBe('hello');
  });
  it('keeps multi-byte text intact', () => {
    expect(decodeOsc52(`c;${enc('héllo ✳ 日本')}`)).toBe('héllo ✳ 日本');
  });
  it('accepts an empty selection name', () => {
    expect(decodeOsc52(`;${enc('x')}`)).toBe('x');
  });
  it('ignores a clipboard query', () => {
    expect(decodeOsc52('c;?')).toBeNull();
  });
  it('rejects malformed payloads', () => {
    expect(decodeOsc52('nosemicolon')).toBeNull();
    expect(decodeOsc52('c;***')).toBeNull();
  });
});

// The copy and paste fixes rest on two xterm behaviours; pin them to the real parser.
describe('xterm integration', () => {
  const write = (term: Terminal, data: string) =>
    new Promise<void>((resolve) => term.write(data, resolve));

  it('routes an OSC 52 write to the handler, as Claude Code emits it', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const got: (string | null)[] = [];
    term.parser.registerOscHandler(52, (data) => {
      got.push(decodeOsc52(data));
      return true;
    });
    await write(term, `before\x1b]52;c;${enc('copied ✳ text')}\x07after`);
    expect(got).toEqual(['copied ✳ text']);
    term.dispose();
  });

  it('reports bracketed paste mode, which gates native Ctrl+V', async () => {
    const term = new Terminal({ allowProposedApi: true });
    expect(term.modes.bracketedPasteMode).toBe(false);
    await write(term, '\x1b[?2004h');
    expect(term.modes.bracketedPasteMode).toBe(true);
    await write(term, '\x1b[?2004l');
    expect(term.modes.bracketedPasteMode).toBe(false);
    term.dispose();
  });
});
