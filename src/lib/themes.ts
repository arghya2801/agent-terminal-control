/**
 * The list of themes on offer: the presets bundled with the app, plus any JSON file in the
 * `themes/` folder of the config directory.
 *
 * A user file with the same name as a preset wins, so a bundled theme can be corrected
 * without editing the app.
 */

import { listThemes } from './ipc';
import { parsePalette, type Palette } from './theme';

/** Bundled presets. Vite inlines these at build time, so there is no fetch on startup. */
const builtinFiles = import.meta.glob<Record<string, unknown>>('../themes/*.json', {
  eager: true,
  import: 'default',
});

function fileStem(path: string): string {
  return path.split('/').pop()?.replace(/\.json$/i, '') ?? path;
}

export const builtinThemes: Palette[] = Object.entries(builtinFiles)
  .flatMap(([path, raw]) => {
    const p = parsePalette(raw, fileStem(path));
    return p ? [p] : [];
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/** Default when settings name no theme, or name one that is not installed. */
export const DEFAULT_THEME = 'ATC Dark';

export function findTheme(themes: Palette[], name: string | null | undefined): Palette {
  const wanted = (name ?? '').trim().toLowerCase();
  const hit = wanted ? themes.find((t) => t.name.toLowerCase() === wanted) : undefined;
  return (
    hit ??
    themes.find((t) => t.name === DEFAULT_THEME) ??
    themes[0] ?? {
      // Only reachable if every bundled file failed to parse, which a test guards against.
      ...parsePalette({ background: '#0b0d10', foreground: '#d6dae0' }, 'Fallback')!,
    }
  );
}

/** Presets merged with the user's folder. Files that will not parse are skipped. */
export async function loadThemes(): Promise<Palette[]> {
  let user: Palette[] = [];
  try {
    user = (await listThemes()).flatMap((t) => {
      const p = parsePalette(t.palette, t.stem);
      return p ? [p] : [];
    });
  } catch {
    // No themes folder, or it could not be read: the presets alone are a working list.
  }
  const byName = new Map(builtinThemes.map((t) => [t.name.toLowerCase(), t]));
  for (const t of user) byName.set(t.name.toLowerCase(), t);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
