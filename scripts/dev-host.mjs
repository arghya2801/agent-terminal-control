// The dev app: Vite for the frontend, and build/bin/atc-dev.exe rebuilt and restarted when Go
// changes. A build without the `production` tag loads its page from FRONTEND_DEVSERVER_URL.
import { existsSync, mkdirSync, writeFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { root } from './playground.mjs';
import { ensureConpty } from './conpty.mjs';
const exe = join(root, 'build', 'bin', 'atc-dev.exe');
const kill = (child) => { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} };

export async function startDev(env = process.env) {
  if (!existsSync(join(root, 'node_modules/vite/bin/vite.js'))) throw new Error('Run bun install first.');
  await ensureConpty();
  // main.go embeds dist/; in development the page comes from Vite.
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><title>ATC development</title>');
  }
  // dist/ has no sidecar bundle in development; the runtime runs the source.
  env = { ...env, FRONTEND_DEVSERVER_URL: 'http://127.0.0.1:1420', ATC_SIDECAR: join(root, 'sidecar', 'agent.ts') };
  const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  let app = null, stopping = false;
  const quit = () => { stopping = true; for (const w of watchers) w.close(); if (app) kill(app); kill(vite); };
  const launch = () => {
    try {
      execFileSync('go', ['build', '-o', exe, '.'], { cwd: root, stdio: 'inherit', windowsHide: true });
    } catch {
      return console.error('go build failed; fix it and save again');
    }
    const me = (app = spawn(exe, [], { cwd: root, env, stdio: 'inherit' }));
    // Closing the window ends the session, as `wails dev` did; a rebuild replaces `app` first.
    me.on('exit', () => { if (!stopping && app === me) quit(); });
  };
  let timer;
  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const old = app;
      app = null;
      if (old) kill(old);
      launch();
    }, 300);
  };
  const isGo = (file) => file && (/\.go$/.test(file) && !/_test\.go$/.test(file) || ['go.mod', 'go.sum'].includes(file));
  const watchers = [
    watch(root, (_, file) => isGo(file) && restart()),
    watch(join(root, 'internal'), { recursive: true }, (_, file) => isGo(file) && restart()),
  ];
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, quit);
  launch();
}
