// End-to-end tests (#97): drive the real app through tauri-driver and WebView2's
// WebDriver, so no synthetic desktop input and no stolen focus.
//
//   npm run test:e2e              build a debug app with the frontend embedded, then test
//   E2E_SKIP_BUILD=1 npm run test:e2e
//
// Needs `cargo install tauri-driver --locked`. The msedgedriver matching the installed
// WebView2 is downloaded on first use.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePlayground, root } from '../scripts/playground.mjs';

const target = join(root, 'src-tauri', 'target-e2e');
const app = join(target, 'debug', 'atc.exe');

if (!process.env.E2E_SKIP_BUILD) {
  // Own target dir: a running `npm run play` holds target/debug/atc.exe open.
  execFileSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--debug', '--no-bundle'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target },
  });
}

/** The WebView2 runtime version; its WebDriver must match it exactly. */
function webview2Version() {
  const clients = String.raw`SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients`;
  // The WebView2 runtime, then Edge itself, which some machines serve WebView2 from.
  const keys = ['{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}'];
  for (const [hive, key] of keys.flatMap((k) => ['HKLM', 'HKCU'].map((h) => [h, `${clients}\\${k}`]))) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', 'pv'], { encoding: 'utf8' });
      const m = out.match(/pv\s+REG_SZ\s+([\d.]+)/);
      if (m) return m[1];
    } catch {
      // Not installed in this hive.
    }
  }
  throw new Error('WebView2 runtime not found');
}

async function edgeDriver() {
  const version = webview2Version();
  const dir = join(target, 'msedgedriver', version);
  const exe = join(dir, 'msedgedriver.exe');
  if (existsSync(exe)) return exe;
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`);
  if (!res.ok) throw new Error(`msedgedriver ${version}: HTTP ${res.status}`);
  const zip = join(dir, 'driver.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${dir}'`]);
  return exe;
}

const config = join(tmpdir(), `atc-e2e-${process.pid}`);
rmSync(config, { recursive: true, force: true });
// Agents are swapped for a cmdlet that just echoes, so a test never starts a real one.
const env = preparePlayground(config, {
  claude: { command: 'Write-Output' },
  codex: { command: 'Write-Output' },
  ui: { restoreTabs: false, notifications: false },
});

const driver = spawn('tauri-driver', ['--native-driver', await edgeDriver()], {
  stdio: 'inherit', env: { ...process.env, ...env },
});
driver.on('error', (e) => {
  console.error(`could not start tauri-driver (cargo install tauri-driver --locked): ${e.message}`);
  process.exit(1);
});
await new Promise((r) => setTimeout(r, 1500));

const tests = spawn(process.execPath, ['--test', join(root, 'e2e', 'app.test.mjs')], {
  stdio: 'inherit', env: { ...process.env, E2E_APP: app },
});
tests.on('exit', (code) => {
  driver.kill();
  rmSync(config, { recursive: true, force: true });
  process.exit(code ?? 1);
});
