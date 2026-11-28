import { describe, expect, it } from 'vitest';
import { fromVsCode } from './vscodeTheme';

describe('fromVsCode', () => {
  it('maps colours and survives comments and trailing commas', () => {
    const p = fromVsCode(`{
      // a comment
      "name": "T", /* block */
      "colors": {
        "editor.background": "#112233ff",
        "editor.foreground": "#ddd",
        "terminal.foreground": "#eeeeee",
        "terminal.ansiRed": "#ff0000",
        "sideBar.background": "#101010",
        "focusBorder": "#00ff00", // http://not-a-comment
      },
    }`);
    expect(p.name).toBe('T');
    expect(p.background).toBe('#112233');
    expect(p.foreground).toBe('#eeeeee');
    expect(p.red).toBe('#ff0000');
    expect(p.ui).toEqual({ '--bg-chrome': '#101010', '--accent': '#00ff00' });
  });
});
