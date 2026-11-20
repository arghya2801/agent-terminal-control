/** The Windows path a link points at (`C:\x`, `C:/x`, `file:///C:/x`), or null for anything else. */
export function localPath(url: string): string | null {
  if (/^[a-zA-Z]:[\\/]/.test(url)) return url;
  const m = /^file:\/\/\/([a-zA-Z]:\/.*)$/i.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replaceAll('/', '\\');
  } catch {
    return null;
  }
}
