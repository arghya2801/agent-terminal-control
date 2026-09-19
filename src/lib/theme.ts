/**
 * Themes: one palette drives the terminal and the app chrome.
 *
 * A theme file is the shape Windows Terminal and VS Code terminal themes already use — 16
 * ANSI colours plus foreground, background, cursor and selection — so an existing port can
 * be pasted in without editing. Everything the chrome needs beyond those (panel surfaces,
 * borders, dimmed text) is mixed from the palette rather than named in the file, because
 * no published palette carries them. That mixing is what lets a light theme work: mixing
 * the background *towards* the foreground lifts a dark surface and darkens a light one.
 */

/** The 16 ANSI names, in the order a palette file lists them. */
export const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

export type AnsiName = (typeof ANSI)[number];

export interface Palette extends Record<AnsiName, string> {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Read a theme file. Returns null rather than throwing: a malformed file in the user's
 * `themes/` folder must not take the app's theme list down with it.
 *
 * Tolerates the spellings the two ecosystems disagree on — Windows Terminal writes
 * `cursorColor` and `purple`, VS Code writes `terminal.ansiMagenta` — and requires only
 * background and foreground, since a palette missing an ANSI slot is still usable.
 */
export function parsePalette(raw: unknown, fallbackName = ''): Palette | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = o[k] ?? o[`terminal.ansi${k[0].toUpperCase()}${k.slice(1)}`];
      if (typeof v === 'string' && HEX.test(v.trim())) return v.trim().toLowerCase();
    }
    return null;
  };

  const background = pick('background');
  const foreground = pick('foreground');
  if (!background || !foreground) return null;

  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : fallbackName;
  if (!name) return null;

  const colours = {} as Record<AnsiName, string>;
  for (const key of ANSI) {
    // `purple` is Windows Terminal's name for magenta. A missing slot falls back to the
    // foreground, which is visible in every palette, rather than to black.
    const alt = key === 'magenta' ? 'purple' : key === 'brightMagenta' ? 'brightPurple' : key;
    colours[key] = pick(key, alt) ?? foreground;
  }

  return {
    ...colours,
    name,
    background,
    foreground,
    cursor: pick('cursor', 'cursorColor') ?? foreground,
    selection: pick('selection', 'selectionBackground') ?? colours.brightBlack,
  };
}

/**
 * The CSS custom properties the chrome reads. Surfaces and dimmed text are mixed from the
 * palette with `color-mix`, which WebView2 supports natively, so a theme file never has to
 * describe the app's own furniture.
 */
export function cssVariables(p: Palette): Record<string, string> {
  const lift = (pct: number) => `color-mix(in srgb, ${p.background} ${pct}%, ${p.foreground})`;
  const dim = (pct: number) => `color-mix(in srgb, ${p.foreground} ${pct}%, ${p.background})`;

  return {
    '--bg': p.background,
    '--fg': dim(88),
    // Chrome sits just off the terminal's background, panels one step further.
    '--bg-chrome': lift(94),
    '--bg-surface': lift(88),
    '--bg-hover': lift(82),
    '--border': lift(78),
    '--fg-bright': p.foreground,
    '--fg-dim': dim(62),
    '--fg-faint': dim(42),
    '--accent': p.brightBlue,
    '--accent-strong': p.blue,
    // Text over an accent or danger fill. On a dark theme that is the background; on a
    // light one the background would vanish into the fill.
    '--on-accent': isLight(p) ? p.brightWhite : p.background,
    '--danger': p.brightRed,
    '--danger-strong': p.red,
    '--warn': p.brightYellow,
    '--ok': p.brightGreen,
    '--info': p.brightMagenta,
    '--selection': p.selection,
  };
}

/**
 * Whether a palette reads as light. Relative luminance of the background, the usual
 * WCAG formula, so `color-scheme` and any future contrast decision agree on one answer.
 */
export function isLight(p: Palette): boolean {
  return luminance(p.background) > 0.4;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
}

/** Write the palette onto the document, replacing whatever theme was applied before. */
export function applyPalette(p: Palette, root: HTMLElement) {
  for (const [name, value] of Object.entries(cssVariables(p))) {
    root.style.setProperty(name, value);
  }
  // Inherited, so every native control — date pickers, number spinners, scrollbars —
  // follows a light theme instead of staying dark against it.
  root.style.colorScheme = isLight(p) ? 'light' : 'dark';
}
