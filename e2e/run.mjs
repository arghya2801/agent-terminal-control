// Drive the desktop app through the WebView2 WebDriver protocol.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { preparePlayground, root } from '../scripts/playground.mjs';

const app = process.env.E2E_APP || join(root, 'build/e2e/atc.exe');
if (!process.env.E2E_SKIP_BUILD) {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [join(root, 'scripts/build-e2e.mjs')], { cwd: root, stdio: 'inherit' });
}
function webviewVersion() {
  const clients = String.raw`SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients`;
  for (const key of ['{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}']) {
    for (const hive of ['HKLM', 'HKCU']) {
      try {
        const text = execFileSync('reg', ['query', `${hive}\\${clients}\\${key}`, '/v', 'pv'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const match = text.match(/pv\s+REG_SZ\s+([\d.]+)/);
        if (match) return match[1];
      } catch {}
    }
  }
  throw new Error('WebView2 runtime not found');
}
async function edgeDriver() {
  const version = webviewVersion();
  const dir = join(root, 'build', 'webdriver', version);
  const exe = join(dir, 'msedgedriver.exe');
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`);
  if (!res.ok) throw new Error(`msedgedriver ${version}: HTTP ${res.status}`);
  const zip = join(dir, 'driver.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const quote = (s) => `'${s.replaceAll("'", "''")}'`;
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath ${quote(zip)} -DestinationPath ${quote(dir)}`], { windowsHide: true });
  return exe;
}
mkdirSync(join(root, 'playground'), { recursive: true });
// Screenshots and runtime memory samples land here; generated, ignored by Git.
mkdirSync(join(root, 'benchmarks'), { recursive: true });
const config = mkdtempSync(join(root, 'playground', 'e2e-'));
const env = preparePlayground(config, { claude: { command: 'Write-Output' }, codex: { command: 'Write-Output' }, ui: { restoreTabs: false, notifications: false } });
const driver = spawn(await edgeDriver(), ['--port=4444'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, ...env, ATC_SHELL_NO_PROFILE: '1' } });
const appChild = spawn(app, [], { stdio: 'inherit', windowsHide: false, env: { ...process.env, ...env, ATC_SHELL_NO_PROFILE: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224' } });
let tests;
const cleanup = async () => {
  if (appChild.exitCode === null) await Promise.race([new Promise(r => appChild.once("exit", r)), new Promise(r => setTimeout(r, 2000))]);
  try { execFileSync('taskkill.exe', ['/PID', String(appChild.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  driver.kill();
  // Only the exact throwaway fixture directory created by this invocation is removed.
  if (resolve(config).startsWith(resolve(root, 'playground') + '\\')) { try { rmSync(config, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.warn('Test profile retained:', config); } }
};
try {
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch('http://127.0.0.1:4444/status')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let n = 0; n < 150; n++) {
    try { if ((await fetch('http://127.0.0.1:9224/json/version')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  tests = spawn(process.execPath, ['--test', ...(process.env.E2E_TEST ? ['--test-name-pattern', process.env.E2E_TEST] : []), join(root, 'e2e', 'app.test.mjs')], { stdio: 'inherit', windowsHide: true, env: { ...process.env, E2E_APP: app, E2E_CONFIG: config, E2E_HOST: 'wails', E2E_DEBUGGER: '127.0.0.1:9224', E2E_PID: String(appChild.pid) } });
  process.exitCode = await new Promise((resolve, reject) => { tests.on('exit', (code) => resolve(code ?? 1)); tests.on('error', reject); });
} finally { await cleanup(); }
