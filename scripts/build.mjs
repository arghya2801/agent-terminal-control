// The frontend, then build/bin/atc.exe: Windows resources from build/windows and wails.json's
// info, then go build, as `wails3 build` does in its Taskfile.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './playground.mjs';
import { runWails } from './wails-cli.mjs';
import { ensureConpty } from './conpty.mjs';
const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true });
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'sidecar/vite.config.ts']);
const { info } = JSON.parse(readFileSync(join(root, 'wails.json'), 'utf8'));
const field = (name) => info[name[0].toLowerCase() + name.slice(1)] ?? '';
const rendered = join(root, 'build', 'windows', 'info.rendered.json');
writeFileSync(rendered, readFileSync(join(root, 'build', 'windows', 'info.json'), 'utf8').replace(/\{\{\.Info\.(\w+)\}\}/g, (_, name) => field(name)));
const syso = join(root, 'wails_windows_amd64.syso');
try {
  runWails(['generate', 'syso', '-arch', 'amd64', '-icon', 'build/windows/icon.ico', '-manifest', 'build/windows/wails.exe.manifest', '-info', rendered, '-out', syso], { cwd: root });
  run('go', ['build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-ldflags', '-w -s -H windowsgui', '-o', join(root, 'build', 'bin', 'atc.exe'), '.']);
} finally {
  rmSync(syso, { force: true });
  rmSync(rendered, { force: true });
}
await ensureConpty();
