import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
const roots = (process.env.PATH || '').split(delimiter);
const goPath = execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8', windowsHide: true }).trim().split(delimiter)[0];
roots.push(process.env.GOBIN || join(goPath, 'bin'));
export const wails3 = roots.map((dir) => join(dir, 'wails3.exe')).find(existsSync);
export function runWails(args, options = {}) {
  if (!wails3) throw new Error('Install the pinned CLI first: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0');
  return execFileSync(wails3, args, { stdio: 'inherit', windowsHide: true, ...options });
}
