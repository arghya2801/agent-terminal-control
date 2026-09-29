import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const roots = (process.env.PATH || '').split(delimiter);
const goPath = execFileSync('go', ['env', 'GOPATH'], { encoding: 'utf8', windowsHide: true }).trim().split(delimiter)[0];
roots.push(process.env.GOBIN || join(goPath, 'bin'));
export const wails = roots.map((dir) => join(dir, process.platform === 'win32' ? 'wails.exe' : 'wails')).find(existsSync);
export function runWails(args, options = {}) {
  if (!wails) throw new Error('Install the pinned CLI first: go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0');
  return spawn(wails, args, { stdio: 'inherit', windowsHide: true, ...options });
}
