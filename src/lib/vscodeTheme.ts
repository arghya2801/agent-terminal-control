import { ANSI, parsePalette, type Palette } from './theme';

/** `//` and `/* *\/` comments and trailing commas, left alone inside strings. */
export function stripJsonc(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const UI: Record<string, string[]> = {
  '--bg-chrome': ['sideBar.background'],
  '--bg-surface': ['editorWidget.background', 'dropdown.background'],
  '--bg-hover': ['list.hoverBackground'],
  '--border': ['panel.border', 'sideBar.border', 'contrastBorder'],
  '--accent': ['focusBorder', 'button.background'],
  '--on-accent': ['button.foreground'],
  '--danger': ['errorForeground'],
  '--fg-dim': ['descriptionForeground'],
};

/** Throws on JSON that will not parse or has no usable background and foreground. */
export function fromVsCode(json: string | Record<string, any>): Palette {
  const doc = typeof json === 'string' ? JSON.parse(stripJsonc(json)) : json;
  const colors: Record<string, unknown> = doc?.colors ?? {};
  const hex = (...keys: string[]) => {
    for (const k of keys) {
      const m = typeof colors[k] === 'string' && /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(colors[k] as string);
      if (m) return `#${m[1].toLowerCase()}`;
    }
  };
  const raw: Record<string, unknown> = {
    name: doc?.name,
    background: hex('terminal.background', 'editor.background'),
    foreground: hex('terminal.foreground', 'editor.foreground'),
    cursor: hex('terminalCursor.foreground'),
    selection: hex('terminal.selectionBackground'),
  };
  for (const a of ANSI) raw[a] = hex(`terminal.ansi${a[0].toUpperCase()}${a.slice(1)}`);
  const ui: Record<string, string> = {};
  for (const [v, keys] of Object.entries(UI)) {
    const c = hex(...keys);
    if (c) ui[v] = c;
  }
  raw.ui = ui;
  const p = parsePalette(raw, 'Imported');
  if (!p) throw new Error('No terminal or editor background and foreground in this theme');
  return p;
}
