// Drive the dev app from the command line, for agents and scripts: no window focus, no OS input.
// `bun scripts/drive.mjs help` lists the commands. ARCHITECTURE.md, Development, explains the setup.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { preparePlayground, root } from './playground.mjs';

const VITE = 1420, APP = 34115, EDGE = Number(process.env.ATC_DRIVE_PORT || 9333);
const home = join(tmpdir(), 'atc-drive');
const stateFile = join(home, 'state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null);
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const listening = (port) => new Promise((r) => {
  // Vite listens on ::1 and Edge on 127.0.0.1; 'localhost' tries both.
  const s = net.connect({ port, host: 'localhost', autoSelectFamily: true });
  s.on('connect', () => { s.destroy(); r(true); });
  s.on('error', () => r(false));
});
async function until(what, fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    try { const v = await fn(); if (v) return v; } catch {}
  }
  throw new Error(`timed out after ${ms / 1000} s waiting for ${what}`);
}
const ps = (command) => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true });
const kill = (pid) => { try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} };
const edgeExe = () => ['ProgramFiles(x86)', 'ProgramFiles'].map((v) => join(process.env[v] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync);

// Runs in the page before the app's own scripts: keeps errors for `logs` and adds `atc` helpers for `eval`.
const PRELUDE = `(() => {
  if (window.atc) return;
  performance.setResourceTimingBufferSize(100000);
  const log = [];
  const keep = (kind, text) => { log.push({ kind, text: String(text), at: Date.now() }); if (log.length > 500) log.shift(); };
  for (const kind of ['error', 'warn']) {
    const orig = console[kind].bind(console);
    console[kind] = (...a) => { keep(kind, a.map((x) => x instanceof Error ? x.stack : typeof x === 'object' ? JSON.stringify(x) : x).join(' ')); orig(...a); };
  }
  addEventListener('error', (e) => keep('exception', e.error?.stack ?? e.message));
  addEventListener('unhandledrejection', (e) => keep('rejection', e.reason?.stack ?? e.reason));
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge({ ...a[k] }, v) : v; return a; };
  window.atc = {
    log,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 5000) { for (const end = Date.now() + ms; Date.now() < end; await atc.sleep(50)) { const v = await fn(); if (v) return v; } throw new Error('atc.until timed out: ' + fn); },
    /** The module instance the app loaded, by the end of its path, e.g. 'terminal/manager.ts'. */
    async mod(path) {
      const url = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => new URL(u).pathname.endsWith('/' + path)).pop();
      if (!url) throw new Error('module not loaded: ' + path);
      return import(url);
    },
    async settings() { return (await atc.mod('lib/stores.svelte.ts')).appState.settings; },
    /** Deep-merge a patch into settings and save it the way the Settings page does. */
    async set(patch) { const s = await atc.mod('lib/stores.svelte.ts'); await s.saveSettings(merge(JSON.parse(JSON.stringify(s.appState.settings)), patch)); return atc.settings(); },
    css: (name, el = document.documentElement) => getComputedStyle(typeof el === 'string' ? document.querySelector(el) : el).getPropertyValue(name).trim(),
    $: (sel) => document.querySelector(sel),
    $$: (sel) => [...document.querySelectorAll(sel)],
  };
})();`;

async function cdp() {
  const targets = await until('the app page in Edge', async () => {
    const t = await (await fetch(`http://127.0.0.1:${EDGE}/json`)).json();
    return t.some((x) => x.type === 'page') && t;
  }, 20000);
  const page = targets.find((t) => t.type === 'page' && t.url.includes(String(APP))) ?? targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cannot connect to Edge')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
  const send = (method, params = {}) => new Promise((r, j) => {
    pending.set(++id, (d) => (d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function launchEdge(state) {
  state.edgeDir = mkdtempSync(join(home, 'edge-'));
  spawn(edgeExe(), ['--headless=new', `--remote-debugging-port=${EDGE}`, `--user-data-dir=${state.edgeDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  const c = await cdp();
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
  await c.send('Page.navigate', { url: `http://localhost:${APP}/` });
  await until('the app to load', () => c.evaluate(`(async () => !!document.querySelector('#app *') && (await atc.mod('lib/stores.svelte.ts')).appState.loading === false)()`), 60000);
  // Vite reloads the page once when it finds new dependencies, and a reload cuts terminals off.
  const origin = await c.evaluate('performance.timeOrigin');
  await sleep(4000);
  const same = await c.evaluate('performance.timeOrigin').then((t) => t === origin, () => false);
  c.close();
  return same;
}

function stopEdge(state) {
  if (!state?.edgeDir) return;
  const dir = state.edgeDir.replaceAll("'", "''");
  try { ps(`Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`); } catch {}
  try { rmSync(state.edgeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

async function start(args) {
  const old = readState();
  if (old && await listening(APP) && await listening(EDGE)) return out({ ok: true, already: true, ...old });
  if (old) await stop();
  for (const port of [VITE, APP, EDGE]) {
    if (await listening(port)) throw new Error(`port ${port} is in use by another process; stop it first (Get-NetTCPConnection -LocalPort ${port})`);
  }
  mkdirSync(home, { recursive: true });
  const config = mkdtempSync(join(home, 'config-'));
  const real = args.includes('--real');
  let env;
  if (real) {
    const mine = join(process.env.APPDATA, 'Agent Terminal Control');
    for (const f of ['settings.json', 'prices-latest.json', 'prices-litellm.json']) if (existsSync(join(mine, f))) copyFileSync(join(mine, f), join(config, f));
    env = { ATC_CONFIG_DIR: config };
  } else {
    env = { ...preparePlayground(config, { ui: { restoreTabs: false, notifications: false } }), VITE_ATC_PLAYGROUND: '1' };
  }
  const log = join(config, 'host.log');
  const host = spawn(process.execPath, [join(root, 'scripts', 'drive.mjs'), '__host'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
    env: { ...process.env, ...env },
  });
  host.unref();
  const state = { root, config, real, host: host.pid, log, url: `http://localhost:${APP}/`, edgePort: EDGE };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  try {
    await until(`the dev app on :${APP} (see ${log})`, async () => (await fetch(`http://localhost:${APP}/`)).ok, 240000);
    let stable = await launchEdge(state);
    if (!stable) { stopEdge(state); stable = await launchEdge(state); }
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    out({ ok: true, ...state });
  } catch (e) {
    const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-30).join('\n') : '';
    await stop();
    throw new Error(`${e.message}\n--- host log ---\n${tail}`);
  }
}

// Wails v3's `server` build: no window, the page and its bindings over HTTP on :34115, proxied
// to Vite. A hidden desktop window would not do: it renders no frames, so requestAnimationFrame
// never fires. Go's build cache makes an unchanged tree build in about a second.
async function host() {
  const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit', windowsHide: true });
  process.on('exit', () => vite.kill());
  const bin = join(root, 'build', 'bin');
  const exe = join(bin, 'atc-server.exe');
  // main.go embeds dist/; the page itself comes from Vite.
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><title>ATC</title>');
  }
  const t = Date.now();
  execFileSync('go', ['build', '-tags', 'server', '-o', exe, '.'], { cwd: root, stdio: 'inherit', windowsHide: true });
  console.log(`go build: ${Date.now() - t} ms`);
  const { ensureConpty } = await import(pathToFileURL(join(root, 'scripts', 'conpty.mjs')).href);
  await ensureConpty(bin);
  await until('Vite', () => listening(VITE), 120000);
  const app = spawn(exe, [], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, WAILS_SERVER_PORT: String(APP), FRONTEND_DEVSERVER_URL: `http://127.0.0.1:${VITE}`, ATC_SIDECAR: join(root, 'sidecar', 'agent.ts') },
  });
  app.on('exit', (code) => process.exit(code ?? 1));
}

async function stop() {
  const state = readState();
  stopEdge(state);
  if (state?.host) kill(state.host);
  // Anything still on the dev ports that runs from this checkout is ours.
  try {
    const here = root.replaceAll("'", "''");
    ps(`Get-NetTCPConnection -State Listen -LocalPort ${VITE},${APP} -ErrorAction SilentlyContinue | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" } | Where-Object { $_.CommandLine -like '*${here}*' -or $_.ExecutablePath -like '${here}*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`);
  } catch {}
  if (state?.config) try { rmSync(state.config, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  rmSync(stateFile, { force: true });
  out({ ok: true, stopped: !!state });
}

async function withPage(fn) {
  if (!readState()) throw new Error('not started: run `bun scripts/drive.mjs start` first');
  const c = await cdp();
  // A reload after start (Vite finishing its dependency scan) drops the prelude; put it back.
  if (!(await c.evaluate('!!window.atc'))) await c.evaluate(PRELUDE);
  try { return await fn(c); } finally { c.close(); }
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  start: () => start(args),
  stop,
  __host: host,
  status: async () => out({ state: readState(), vite: await listening(VITE), app: await listening(APP), edge: await listening(EDGE) }),
  eval: () => withPage(async (c) => {
    const code = args[0] === '-f' ? readFileSync(args[1], 'utf8') : args.join(' ');
    // An expression prints its value; statements need their own `return`.
    const run = (body) => c.evaluate(`(async () => { ${body} })()`);
    out((await run(`return (${code}
)`).catch((e) => (/^SyntaxError/.test(e.message) ? run(code) : Promise.reject(e)))) ?? null);
  }),
  logs: () => withPage(async (c) => out(await c.evaluate(`(() => { const l = [...atc.log]; ${args.includes('--clear') ? 'atc.log.length = 0;' : ''} return l; })()`))),
  shot: () => withPage(async (c) => {
    const file = args[0] ?? join(home, 'shot.png');
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    out({ ok: true, file });
  }),
  help: () => out(`bun scripts/drive.mjs <command>
  start [--real]   Start the dev app (fixtures, or --real for ~/.claude with a throwaway config) and a headless page on it
  eval <js>        Run JS in the page and print the result. eval -f <file> runs a file. Helpers on window.atc:
                   mod(path), settings(), set(patch), until(fn, ms), sleep(ms), css(name, el), $(sel), $$(sel), log
  logs [--clear]   Console errors and warnings, uncaught exceptions and rejections since the page loaded
  shot [file.png]  Screenshot the page
  status           What is running
  stop             Stop everything start started and delete its throwaway config`),
};
if (!commands[cmd]) { commands.help(); process.exitCode = 1; }
else await commands[cmd]().catch((e) => { console.error(e.message); process.exitCode = 1; });
