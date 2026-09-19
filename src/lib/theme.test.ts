import { describe, expect, it } from 'vitest';
import { applyPalette, cssVariables, isLight, parsePalette, type Palette } from './theme';
import { builtinThemes, DEFAULT_THEME, findTheme } from './themes';

const minimal = { background: '#1e1e2e', foreground: '#cdd6f4' };

describe('parsePalette', () => {
  it('reads a Windows Terminal palette, including its own spellings', () => {
    const p = parsePalette({
      name: 'Nord',
      background: '#2e3440',
      foreground: '#d8dee9',
      cursorColor: '#d8dee9',
      selectionBackground: '#434c5e',
      purple: '#b48ead',
      brightPurple: '#b48ead',
    });
    expect(p?.name).toBe('Nord');
    expect(p?.cursor).toBe('#d8dee9');
    expect(p?.selection).toBe('#434c5e');
    // `purple` is Windows Terminal's name for the magenta slot.
    expect(p?.magenta).toBe('#b48ead');
    expect(p?.brightMagenta).toBe('#b48ead');
  });

  it('reads the VS Code terminal.ansi* spelling', () => {
    const p = parsePalette({ ...minimal, name: 'X', 'terminal.ansiRed': '#f38ba8' });
    expect(p?.red).toBe('#f38ba8');
  });

  it('falls back to the file name when the palette has none', () => {
    expect(parsePalette(minimal, 'my-theme')?.name).toBe('my-theme');
    expect(parsePalette({ ...minimal, name: '   ' }, 'my-theme')?.name).toBe('my-theme');
  });

  it('fills a missing ANSI slot with the foreground, never with nothing', () => {
    const p = parsePalette(minimal, 'X')!;
    expect(p.blue).toBe(minimal.foreground);
    expect(p.selection).toBe(minimal.foreground); // via brightBlack, itself defaulted
  });

  it('refuses a file it cannot colour the app from', () => {
    expect(parsePalette(null)).toBeNull();
    expect(parsePalette('nope')).toBeNull();
    expect(parsePalette({ foreground: '#ffffff' }, 'X')).toBeNull();
    expect(parsePalette(minimal)).toBeNull(); // no name, none supplied
    expect(parsePalette({ background: 'red', foreground: '#fff' }, 'X')).toBeNull();
  });

  it('normalises casing and whitespace, and accepts the short hex form', () => {
    const p = parsePalette({ background: ' #FFF ', foreground: '#000000' }, 'X')!;
    expect(p.background).toBe('#fff');
  });
});

describe('cssVariables', () => {
  const dark = parsePalette({ ...minimal, name: 'dark', brightBlue: '#89b4fa' })!;
  const light = parsePalette({ background: '#eff1f5', foreground: '#4c4f69' }, 'light')!;

  it('uses the palette background and its blue as the accent', () => {
    const v = cssVariables(dark);
    expect(v['--bg']).toBe('#1e1e2e');
    expect(v['--accent']).toBe('#89b4fa');
  });

  it('mixes surfaces from the palette rather than naming them', () => {
    const v = cssVariables(dark);
    // Mixing towards the foreground is what makes one formula work for both polarities.
    expect(v['--bg-surface']).toContain('color-mix');
    expect(v['--bg-surface']).toContain(dark.background);
    expect(v['--bg-surface']).toContain(dark.foreground);
  });

  it('keeps text over an accent fill readable in both polarities', () => {
    expect(cssVariables(dark)['--on-accent']).toBe(dark.background);
    expect(cssVariables(light)['--on-accent']).toBe(light.brightWhite);
  });
});

describe('isLight', () => {
  it('tells the two polarities apart', () => {
    expect(isLight(parsePalette({ background: '#eff1f5', foreground: '#4c4f69' }, 'l')!)).toBe(true);
    expect(isLight(parsePalette({ background: '#1e1e2e', foreground: '#cdd6f4' }, 'd')!)).toBe(
      false,
    );
  });
});

describe('applyPalette', () => {
  it('writes every variable and sets the colour scheme from the background', () => {
    const root = document.createElement('div');
    const light = parsePalette({ background: '#eff1f5', foreground: '#4c4f69' }, 'l')!;

    applyPalette(light, root);

    expect(root.style.getPropertyValue('--bg')).toBe('#eff1f5');
    expect(root.style.colorScheme).toBe('light');
    for (const name of Object.keys(cssVariables(light))) {
      expect(root.style.getPropertyValue(name)).not.toBe('');
    }
  });
});

describe('the bundled presets', () => {
  it('all parse, so the list is never empty', () => {
    expect(builtinThemes.length).toBeGreaterThanOrEqual(5);
    for (const t of builtinThemes) {
      expect(t.background).toMatch(/^#[0-9a-f]{3,6}$/);
      expect(t.name).not.toBe('');
    }
  });

  it('includes the default, and a light one to prove the mixing works both ways', () => {
    expect(builtinThemes.map((t) => t.name)).toContain(DEFAULT_THEME);
    expect(builtinThemes.some((t) => isLight(t))).toBe(true);
  });

  it('keeps ATC Dark matching the palette the terminal used before themes existed', () => {
    const atc = builtinThemes.find((t) => t.name === DEFAULT_THEME)!;
    expect(atc.background).toBe('#0b0d10');
    expect(atc.foreground).toBe('#d6dae0');
    expect(atc.blue).toBe('#539bf5');
    expect(atc.magenta).toBe('#b083f0');
    expect(atc.brightWhite).toBe('#cdd9e5');
    expect(atc.selection).toBe('#2a3b52');
  });
});

describe('findTheme', () => {
  const themes = [
    parsePalette({ ...minimal, name: DEFAULT_THEME })!,
    parsePalette({ ...minimal, name: 'Nord' })!,
  ];

  it('matches by name, ignoring case and stray whitespace', () => {
    expect(findTheme(themes, 'nord').name).toBe('Nord');
    expect(findTheme(themes, '  Nord ').name).toBe('Nord');
  });

  it('falls back to the default for a name that is not installed', () => {
    // A deleted theme file must leave a working app, not an unstyled one.
    expect(findTheme(themes, 'Deleted Theme').name).toBe(DEFAULT_THEME);
    expect(findTheme(themes, '').name).toBe(DEFAULT_THEME);
    expect(findTheme(themes, null).name).toBe(DEFAULT_THEME);
  });

  it('returns something even when the default itself is missing', () => {
    const only = [parsePalette({ ...minimal, name: 'Only' })!] as Palette[];
    expect(findTheme(only, 'nope').name).toBe('Only');
  });
});
