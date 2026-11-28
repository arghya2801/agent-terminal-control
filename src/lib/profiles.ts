import type { Settings } from '../types';

type Ui = Settings['ui'];

export const PROFILE_KEYS = [
  'theme', 'accent', 'backdrop', 'zoom', 'animations', 'animationSpeed', 'stateShapes',
  'chatFontSize', 'chatFontFamily', 'fontFamily', 'fontSize', 'corners', 'hide', 'tabClose',
  'sidebarSide', 'tabBarPosition', 'showTabBar', 'sidebarDensity', 'chatWidth', 'chatLineHeight',
  'chatSpacing', 'userBubble', 'userBubbleWidth', 'codeWrap', 'codeFontFamily', 'toolsOpen',
  'thinkingOpen', 'hideToolCalls', 'toastCorner',
] as const satisfies readonly (keyof Ui)[];

/** Only the look-and-feel keys of `ui`. Anything else, including unknown keys, is dropped. */
export function pickProfile(ui: object): Partial<Ui> {
  const src = ui as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) if (k in src) out[k] = JSON.parse(JSON.stringify(src[k]));
  return out as Partial<Ui>;
}

export function applyProfile(ui: Ui, profile: Partial<Ui>) {
  Object.assign(ui, pickProfile(profile));
}
