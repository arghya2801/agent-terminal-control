import type { ITheme } from '@xterm/xterm';

/** Default dark palette. Becomes settings-driven in phase 3. */
export const defaultTheme: ITheme = {
  background: '#0b0d10',
  foreground: '#d6dae0',
  cursor: '#d6dae0',
  cursorAccent: '#0b0d10',
  selectionBackground: '#2a3b52',
  black: '#1b1f24',
  red: '#e5534b',
  green: '#57ab5a',
  yellow: '#c69026',
  blue: '#539bf5',
  magenta: '#b083f0',
  cyan: '#39c5cf',
  white: '#adbac7',
  brightBlack: '#545d68',
  brightRed: '#f47067',
  brightGreen: '#6bc46d',
  brightYellow: '#daaa3f',
  brightBlue: '#6cb6ff',
  brightMagenta: '#dcbdfb',
  brightCyan: '#56d4dd',
  brightWhite: '#cdd9e5',
};

/** Nerd Font first: powerline prompts and Claude Code's TUI both use glyphs that
 *  plain Consolas renders as replacement boxes. */
export const defaultFontFamily =
  '"FiraCode Nerd Font Mono", "CaskaydiaCove Nerd Font", "Cascadia Mono", Consolas, monospace';
export const defaultFontSize = 13;
export const defaultScrollback = 10_000;

/** Colours for search highlights, so matches are visible against our palette. */
export const searchDecorations = {
  matchBackground: '#3b2f00',
  matchBorder: '#7a6200',
  matchOverviewRuler: '#daaa3f',
  activeMatchBackground: '#7a6200',
  activeMatchBorder: '#daaa3f',
  activeMatchColorOverviewRuler: '#daaa3f',
};
