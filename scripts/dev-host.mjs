// Wails v2 walks every directory before filtering ignores. Keep its watch root small:
// transient WebView caches and generated build trees must not break Go reloads.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runWails } from './wails-cli.mjs';
import { root } from './playground.mjs';
import { ensureConpty } from './conpty.mjs';
await ensureConpty();
export function startDev(env = process.env, args = []) {
  if (!existsSync(join(root, 'node_modules/vite/bin/vite.js'))) throw new Error('Run npm ci first.');
  const stage = join(root, 'wails-dev-work');
  mkdirSync(join(stage, 'dist'), { recursive: true });
  writeFileSync(join(stage, 'dist/index.html'), '<!doctype html><title>ATC development</title>');
  let known = new Set();
  const existing = (dir) => { if (!existsSync(join(stage,dir))) return; for (const e of readdirSync(join(stage,dir), {withFileTypes:true})) {
    const file=join(dir,e.name); if (e.isDirectory()) { if (dir || e.name==='internal') existing(file); }
    else if (dir || e.name.endsWith('.go') || ['go.mod','go.sum'].includes(e.name)) known.add(file);
  } }; existing('');
  const copy = (source, target) => {
    let data;
    // Editors save through temp files that can vanish between listing and reading.
    try { data = readFileSync(source); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (existsSync(target) && readFileSync(target).equals(data)) return;
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data);
  };
  const sync = () => {
    const files = readdirSync(root).filter(f => (f.endsWith('.go') && !f.endsWith('_test.go')) || ['go.mod', 'go.sum'].includes(f));
    const walk = (dir) => { for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!entry.name.endsWith('_test.go')) files.push(path);
    } };
    walk('internal');
    const next = new Set(files);
    for (const file of files) copy(join(root, file), join(stage, file));
    for (const old of known) if (!next.has(old) && existsSync(join(stage, old))) unlinkSync(join(stage, old));
    known = next;
    const config = JSON.parse(readFileSync(join(root, 'wails.json'), 'utf8'));
    config['frontend:dir'] = root; config['build:dir'] = join(root, 'build');
    const data = JSON.stringify(config, null, 2);
    const target = join(stage, 'wails.json');
    if (!existsSync(target) || readFileSync(target,'utf8') !== data) writeFileSync(target, data);
  };
  sync();
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(sync, 100); };
  const watchers = [
    watch(root, (_, file) => { if (file && (/\.go$/.test(file) || ['go.mod','go.sum','wails.json'].includes(file))) schedule(); }),
    watch(join(root, 'internal'), { recursive: true }, schedule),
  ];
  const child = runWails(['dev', '-s', '-skipbindings', '-m', '-nosyncgomod', '-extensions', 'go,json,mod,sum', ...args], { cwd: stage, env });
  const cleanup = () => { clearTimeout(timer); for (const w of watchers) w.close(); };
  child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
  child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    cleanup();
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  });
  return child;
}
