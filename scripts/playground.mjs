// A writable copy of the fixtures, with settings pointing ATC at it. Shared by
// `npm run play` and the end-to-end tests, so both see the same projects and sessions.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS = ['game_tracker_app', 'portfolio2'];

function copyFixtures(source, target, projects) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyFixtures(from, to, projects);
    else if (!existsSync(to)) {
      let text = readFileSync(from, 'utf8');
      for (const name of PROJECTS) {
        text = text.replaceAll(JSON.stringify(`D:\\Coding\\${name}`).slice(1, -1), JSON.stringify(join(projects, name)).slice(1, -1));
      }
      writeFileSync(to, text);
    }
  }
}

/**
 * Build the playground in `config` and return the environment to run ATC with. `extra`
 * sections are merged into settings, e.g. to swap the agent commands for harmless ones.
 */
export function preparePlayground(config, extra = {}) {
  const claude = join(config, 'claude');
  const codex = join(config, 'codex');
  const projects = join(config, 'projects');
  for (const name of PROJECTS) mkdirSync(join(projects, name), { recursive: true });
  copyFixtures(join(root, 'fixtures', 'claude-projects'), join(claude, 'projects'), projects);
  copyFixtures(join(root, 'fixtures', 'codex'), codex, projects);
  const settingsPath = join(config, 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  settings.projects = { ...settings.projects, claudeProjectsDir: join(claude, 'projects') };
  settings.codex = { ...settings.codex, homeDir: codex };
  for (const [section, values] of Object.entries(extra)) settings[section] = { ...settings[section], ...values };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { ATC_CONFIG_DIR: config, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude };
}
