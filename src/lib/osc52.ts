/**
 * Decodes an OSC 52 payload (`<selection>;<base64>`) to text. Returns null for a
 * clipboard query (`?`) or anything malformed.
 */
export function decodeOsc52(data: string): string | null {
  const sep = data.indexOf(';');
  if (sep < 0) return null;
  const b64 = data.slice(sep + 1);
  if (b64 === '?') return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
