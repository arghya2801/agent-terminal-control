/** A title's trailing "(Ctrl+Shift+B)" split off, so it can be drawn as a key chip. */
export function splitChord(title: string): { text: string; chord: string | null } {
  const m = /^([\s\S]*?)\s*\(([^()\s]+)\)$/.exec(title.trim());
  // Only a bare chord: "(double-click to rename)" stays part of the text.
  if (!m || !/^((Ctrl|Shift|Alt)\+)+[^+]+$|^(Esc|Enter|Tab|F\d{1,2})$/.test(m[2])) return { text: title.trim(), chord: null };
  return { text: m[1], chord: m[2] };
}
