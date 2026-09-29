// Wails v2.16 clears external WebView2 browser flags. The E2E executable uses
// a temporary local copy of its loader with a loopback debugging port enabled.
// Production go.mod, production binaries and the module cache are unchanged.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './playground.mjs';
const module = JSON.parse(execFileSync('go', ['list', '-m', '-json', 'github.com/wailsapp/go-webview2'], { cwd: root, encoding: 'utf8' }));
const dir = join(root, 'build', 'e2e');
const local = join(dir, 'go-webview2');
mkdirSync(dir, { recursive: true });
if (!existsSync(local)) cpSync(module.Dir, local, { recursive: true });
const path = join(local, 'pkg', 'edge', 'create_env_go.go');
const source = readFileSync(join(module.Dir, 'pkg', 'edge', 'create_env_go.go'), 'utf8');
const needle = 'webviewloader.WithAdditionalBrowserArguments(additionalBrowserArgs)';
if (!source.includes(needle)) throw new Error('WebView2 loader changed: review the E2E patch');
chmodSync(path, 0o644);
writeFileSync(path, source.replace(needle, 'webviewloader.WithAdditionalBrowserArguments(additionalBrowserArgs + " --remote-debugging-port=9224")'));
const modfile = join(dir, 'e2e.mod');
writeFileSync(modfile, readFileSync(join(root, 'go.mod'), 'utf8') + `\nreplace github.com/wailsapp/go-webview2 => ${JSON.stringify(local.replaceAll('\\', '/'))}\n`);
writeFileSync(join(dir, 'e2e.sum'), readFileSync(join(root, 'go.sum')));
execFileSync('go', ['build', '-modfile', modfile, '-tags', 'desktop,production,devtools', '-ldflags', '-H windowsgui', '-o', join(dir, 'atc.exe'), '.'], { cwd: root, stdio: 'inherit', windowsHide: true });


