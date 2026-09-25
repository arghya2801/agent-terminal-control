// Isolated writable histories for both discovery and launched CLIs.
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { preparePlayground, root } from './playground.mjs';

const env = preparePlayground(join(root, 'playground', 'config'));
const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ...env, VITE_ATC_PLAYGROUND: '1' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
