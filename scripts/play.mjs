// Isolated writable histories for both discovery and launched CLIs.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = join(root, 'playground', 'config');
const claude = join(config, 'claude');
const codex = join(config, 'codex');
const projects = join(config, 'projects');
for (const name of ['game_tracker_app', 'portfolio2']) mkdirSync(join(projects, name), { recursive: true });

function copyFixtures(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyFixtures(from, to);
    else if (!existsSync(to)) {
      let text = readFileSync(from, 'utf8');
      for (const name of ['game_tracker_app', 'portfolio2']) {
        text = text.replaceAll(JSON.stringify(`D:\\Coding\\${name}`).slice(1, -1), JSON.stringify(join(projects, name)).slice(1, -1));
      }
      writeFileSync(to, text);
    }
  }
}
copyFixtures(join(root, 'fixtures', 'claude-projects'), join(claude, 'projects'));
copyFixtures(join(root, 'fixtures', 'codex'), codex);
const settingsPath = join(config, 'settings.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
settings.projects = { ...settings.projects, claudeProjectsDir: join(claude, 'projects') };
settings.codex = { ...settings.codex, homeDir: codex };
writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ATC_CONFIG_DIR: config, VITE_ATC_PLAYGROUND: '1', CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
