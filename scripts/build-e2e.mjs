// The e2e executable: a production build with DevTools compiled in. e2e/run.mjs starts it with
// ATC_DEBUG_PORT, which main.go turns into WebView2's remote debugging port for WebDriver.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './playground.mjs';
execFileSync('go', ['build', '-tags', 'production,devtools', '-ldflags', '-H windowsgui', '-o', join(root, 'build', 'e2e', 'atc.exe'), '.'], { cwd: root, stdio: 'inherit', windowsHide: true });
