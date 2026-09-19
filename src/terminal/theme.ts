import type { ITheme } from '@xterm/xterm';
import { ANSI, parsePalette, type Palette } from '../lib/theme';
import atcDark from '../themes/atc-dark.json';

/**
 * Fallback palette, used until settings have been read and whenever the named theme is
 * missing. The bundled `atc-dark.json` is the source of truth for these values; parsing it
 * here rather than repeating them keeps the two from drifting.
 */
export const defaultPalette: Palette = parsePalette(atcDark, 'ATC Dark')!;

/** The same palette in xterm's shape. */
export const defaultTheme: ITheme = xtermTheme(defaultPalette);

/** The xterm view of a palette. `cursorAccent` is the text under the block cursor, so it
 *  has to be the background or the character vanishes. */
export function xtermTheme(p: Palette): ITheme {
  const ansi: Record<string, string> = {};
  for (const key of ANSI) ansi[key] = p[key];
  return {
    ...ansi,
    background: p.background,
    foreground: p.foreground,
    cursor: p.cursor,
    cursorAccent: p.background,
    selectionBackground: p.selection,
  };
}

/** Nerd Font first: powerline prompts and Claude Code's TUI both use glyphs that
 *  plain Consolas renders as replacement boxes. */
export const defaultFontFamily =
  '"FiraCode Nerd Font Mono", "CaskaydiaCove Nerd Font", "Cascadia Mono", Consolas, monospace';
export const defaultFontSize = 13;
export const defaultScrollback = 10_000;

/**
 * Colours for search highlights. Built from the palette's yellow so matches stand out in
 * whatever theme is active: a dim mix with the background for the fill, the yellow itself
 * for the border and the active match.
 */
export function searchDecorations(p: Palette) {
  const fill = (pct: number) => `color-mix(in srgb, ${p.yellow} ${pct}%, ${p.background})`;
  return {
    matchBackground: fill(25),
    matchBorder: fill(55),
    matchOverviewRuler: p.brightYellow,
    activeMatchBackground: fill(55),
    activeMatchBorder: p.brightYellow,
    activeMatchColorOverviewRuler: p.brightYellow,
  };
}
