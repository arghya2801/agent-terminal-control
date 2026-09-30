// Puts Windows Terminal's conpty.dll and OpenConsole.exe next to the built exe (#116).
// The package is pinned by version and SHA-256; bump both together.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './playground.mjs';

const version = '1.24.260710001';
const sha256 = '175640566a3b59c4b132070ee96c2c77e5ab7edd2e92732a5eb3610bbf63d90e';
const files = { 'conpty.dll': 'runtimes/win-x64/native/conpty.dll', 'OpenConsole.exe': 'build/native/runtimes/x64/OpenConsole.exe' };

export async function ensureConpty(bin = join(root, 'build/bin')) {
  if (Object.keys(files).every((f) => existsSync(join(bin, f)))) return;
  const cache = join(root, 'build/conpty', version);
  const pkg = join(cache, 'conpty.nupkg');
  if (!existsSync(pkg)) {
    const res = await fetch(`https://www.nuget.org/api/v2/package/Microsoft.Windows.Console.ConPTY/${version}`);
    if (!res.ok) throw new Error(`ConPTY download failed: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(data).digest('hex');
    if (got !== sha256) throw new Error(`ConPTY package checksum mismatch: ${got}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(pkg, data);
  }
  // A .nupkg is a zip; Windows' bsdtar reads zips.
  execFileSync(join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'), ['-xf', pkg, '-C', cache, ...Object.values(files)], { windowsHide: true });
  mkdirSync(bin, { recursive: true });
  for (const [name, path] of Object.entries(files)) copyFileSync(join(cache, path), join(bin, name));
}
