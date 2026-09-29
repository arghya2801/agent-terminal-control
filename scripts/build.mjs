import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './playground.mjs';
import { wails } from './wails-cli.mjs';
if (!wails) throw new Error('Install the pinned CLI: go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0');
const run = (exe, args) => execFileSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true });
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
run(wails, ['build', '-s', '-skipbindings', '-m', '-nosyncgomod', ...process.argv.slice(2)]);
