// Runs under `npm run test:e2e` (see run.mjs), against the fixture playground.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Key, remote } from 'webdriverio';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** @type {import('webdriverio').Browser} */
let browser;

before(async () => {
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    connectionRetryCount: 0,
    connectionRetryTimeout: 20000,
    capabilities: { 'wdio:enforceWebDriverClassic': true, browserName: 'webview2', 'ms:edgeOptions': process.env.E2E_DEBUGGER ? { debuggerAddress: process.env.E2E_DEBUGGER } : { binary: process.env.E2E_APP } },
  });
  await (await browser.$('.bar .shown b')).waitForDisplayed({ timeout: 20000 });
  await browser.execute(() => { window.__atcKeys = []; window.addEventListener('keydown', (e) => { window.__atcKeys.push({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, target: e.target?.tagName }); window.__atcKeys = window.__atcKeys.slice(-30); }, true); });
});

after(async () => {
  if (browser) {
    mkdirSync('benchmarks', { recursive: true });
    try { await browser.saveScreenshot(join(process.cwd(), 'benchmarks', 'e2e-last.png')); } catch {}
    try { console.log('Final page:', await browser.getUrl()); } catch {}
  }
  if (browser && process.env.E2E_HOST === 'wails') { try { await browser.execute(() => window.runtime.Quit()); } catch {} }
  try { await browser?.deleteSession(); } catch {}
});

/** A chord such as Ctrl+Shift+U, pressed and released. */
async function chord(key) {
  await browser.action('key').down(Key.Ctrl).down(Key.Shift).down(key).up(key).up(Key.Shift).up(Key.Ctrl).perform();
}

const byText = (tag, text) => browser.$(`${tag}*=${text}`);
/** Every open tab has a row in the Open view, shown or not. */
const tabCount = async () => (await browser.$$('.open-list .row')).length;
const shownTitle = async () => (await browser.$('.bar .shown b')).getText();

describe('ATC', () => {
  it('lists the fixture projects and opens a session in a tab', async () => {
    await (await browser.$('button[role="tab"]*=Sessions')).click();
    const session = await byText('button', 'fix the scoreboard');
    await session.waitForDisplayed({ timeout: 20_000 });
    assert.ok(await (await byText('button', 'game_tracker_app')).isDisplayed());
    await session.click();
    await browser.waitUntil(async () => /scoreboard/i.test(await shownTitle()));
    assert.ok(await tabCount() >= 1);
  });

  it('lists the open tabs in the Open view, the active one selected', async () => {
    await (await browser.$('button[role="tab"]*=Open')).click();
    const active = await browser.$('.open-list .row.active');
    await active.waitForDisplayed();
    assert.ok((await active.getText()).includes(await shownTitle()));
  });

  it('opens the Usage page and closes it with Escape', async () => {
    await chord('u');
    const heading = await browser.$('h1=Usage');
    await heading.waitForDisplayed();
    await browser.keys('Escape');
    await heading.waitForDisplayed({ reverse: true });
  });
});





const configFile = (name) => join(process.env.E2E_CONFIG, name);
const readSettings = () => JSON.parse(readFileSync(configFile('settings.json'), 'utf8'));
const readNotes = () => { try { return readFileSync(configFile('notes.md'), 'utf8'); } catch { return ''; } };
async function settingsPage() { await (await browser.$('button[aria-label="More"]')).click(); await (await browser.$('button.item*=Settings')).click(); await (await browser.$('h1=Settings')).waitForDisplayed(); }
async function shellCommand(command) { await browser.pause(900); await browser.keys(command); await browser.keys(Key.Enter); }
async function findOutput(text) {
  await chord('f'); const input = await browser.$('input[aria-label="Find in terminal"]'); await input.waitForDisplayed(); await input.setValue(text);
  await browser.waitUntil(async () => /\d/.test(await (await browser.$('.find .count')).getText()), { timeout: 15000, timeoutMsg: `Terminal did not produce ${text}` });
  await (await browser.$('button[aria-label="Close find"]')).click();
}
function sampleRuntime(label) {
  if (!process.env.E2E_PID) return;
  execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/sample-runtime.ps1', '-RootProcessId', process.env.E2E_PID, '-Output', `benchmarks/${process.env.E2E_HOST}-${label}.json`], { windowsHide: true });
}

describe('desktop behaviour', () => {
  it('edits Markdown notes, ticks a box and persists both', async () => {
    await (await browser.$('button[role="tab"]*=Open')).click();
    await (await browser.$('.notes .md')).click();
    await (await browser.$('.notes textarea')).setValue('- [ ] **Keep this note**');
    await browser.keys(Key.Escape);
    await (await browser.$('.notes strong=Keep this note')).waitForDisplayed();
    await browser.waitUntil(() => readNotes().includes('- [ ] **Keep this note**'));
    await (await browser.$('.notes input[data-box="0"]')).click();
    await browser.waitUntil(() => readNotes().includes('- [x] **Keep this note**'));
  });
  it('filters sessions by label and resets the filter', async () => {
    await (await browser.$('button[role="tab"]*=Sessions')).click();
    await (await browser.$('button[aria-label="Filter"]')).click();
    const filter = await browser.$('input[aria-label="Filter projects and sessions"]');
    await filter.setValue('Renamed Codex');
    await (await byText('button', 'Renamed Codex session')).waitForDisplayed();
    assert.equal(await (await byText('button', 'Portfolio refresh')).isExisting(), false);
    await filter.setValue(''); await browser.keys(Key.Escape);
  });
  it('reuses a session tab instead of duplicating it', async () => {
    const count = (await tabCount());
    await (await byText('button', 'fix the scoreboard')).click();
    assert.equal((await tabCount()), count);
  });
  it('opens a fresh shell and round-trips a command through ConPTY', async () => {
    const before = (await tabCount());
    await chord('t');
    await browser.waitUntil(async () => (await tabCount()) === before + 1, { timeoutMsg: 'New tab shortcut failed' });
    await shellCommand("Write-Output ('E2E_' + 'ROUNDTRIP')");
    await findOutput('E2E_ROUNDTRIP');
  });
  it('preserves Unicode through terminal output and search', async () => {
    await shellCommand("Write-Output ([char]0x4e16 + [string][char]0x754c + '_OK')");
    await findOutput('世界_OK');
  });
  it('streams a large output burst without losing the last line', async () => {
    await shellCommand("1..3000 | ForEach-Object { Write-Output ('BULK_' + $_) }");
    await findOutput('BULK_3000');
  });
  it('renames a tab and cycles tabs with Ctrl+Tab', async () => {
    await chord('r'); const rename = await browser.$('.bar input.rename'); await rename.waitForDisplayed();
    await browser.keys([Key.Ctrl, 'a']); await browser.keys('Behaviour shell'); await browser.keys(Key.Enter);
    assert.match(await shownTitle(), /Behaviour shell/);
    await browser.action('key').down(Key.Ctrl).down(Key.Tab).up(Key.Tab).up(Key.Ctrl).perform();
    assert.doesNotMatch(await shownTitle(), /Behaviour shell/);
    await browser.action('key').down(Key.Ctrl).down(Key.Shift).down(Key.Tab).up(Key.Tab).up(Key.Shift).up(Key.Ctrl).perform();
    assert.match(await shownTitle(), /Behaviour shell/);
  });
  it('splits the terminal and moves focus between panes', async () => {
    await chord('\\');
    await browser.waitUntil(async () => {
      const terminals = await browser.$$('.xterm'); let visible = 0; for (const t of terminals) if (await t.isDisplayed()) visible++; return visible === 2;
    });
    await shellCommand("Write-Output ('SPLIT_' + 'RIGHT')"); await findOutput('SPLIT_RIGHT');
    await chord('o'); await shellCommand("Write-Output ('SPLIT_' + 'LEFT')"); await findOutput('SPLIT_LEFT');
    await browser.saveScreenshot(`benchmarks/${process.env.E2E_HOST}-split.png`);
    sampleRuntime('split');
    await chord('\\');
  });
  it('toggles the sidebar through its shortcut', async () => {
    await chord('b'); await (await browser.$('button[aria-label="Filter"]')).waitForDisplayed({ reverse: true });
    await chord('b'); await (await browser.$('button[aria-label="Filter"]')).waitForDisplayed();
  });
  it('changes theme, font and grouping and saves them', async () => {
    await settingsPage();
    await (await browser.$('#th')).selectByVisibleText('Nord');
    await (await browser.$('#fs')).setValue('15');
    await (await browser.$('#gb')).click();
    await browser.waitUntil(() => readSettings().terminal.fontSize === 15 && readSettings().ui.theme === 'Nord' && readSettings().ui.groupByBranch === true);
    await browser.saveScreenshot(`benchmarks/${process.env.E2E_HOST}-settings.png`);
    await browser.keys(Key.Escape);
    await (await browser.$('.branch-head')).waitForDisplayed();
  });
  it('applies external settings edits live and ignores malformed edits', async () => {
    const settings = readSettings(); settings.terminal.fontSize = 17; settings.ui.theme = 'ATC Dark';
    writeFileSync(configFile('settings.json'), JSON.stringify(settings));
    await browser.waitUntil(async () => await browser.execute(() => document.documentElement.style.getPropertyValue('--bg')) === '#0b0d10');
    await settingsPage();
    await browser.waitUntil(async () => (await (await browser.$('#fs')).getValue()) === '17');
    await browser.keys(Key.Escape);
    writeFileSync(configFile('settings.json'), '{ broken');
    await browser.pause(650);
    assert.equal(readFileSync(configFile('settings.json'), 'utf8'), '{ broken');
    writeFileSync(configFile('settings.json'), JSON.stringify(settings));
  });
  it('applies an external notes edit live', async () => {
    writeFileSync(configFile('notes.md'), `${readNotes()}\n- [ ] Written outside ATC\n`);
    await (await browser.$('button[role="tab"]*=Open')).click();
    await (await browser.$('.notes li*=Written outside ATC')).waitForDisplayed();
    await (await browser.$('button[role="tab"]*=Sessions')).click();
  });
  it('discovers and renames a transcript added while running', async () => {
    const path = configFile('claude/projects/D--Coding-game-tracker-app/e2e-live.jsonl');
    const cwd = configFile('projects/game_tracker_app');
    writeFileSync(path, JSON.stringify({ type: 'user', cwd, message: { content: 'Live transcript discovered' } }) + '\n');
    await (await byText('button', 'Live transcript discovered')).waitForDisplayed();
    appendFileSync(path, JSON.stringify({ type: 'agent-name', agentName: 'Renamed while running' }) + '\n');
    await (await byText('button', 'Renamed while running')).waitForDisplayed();
  });
  it('zooms the whole app and resets it', async () => {
    await browser.keys([Key.Ctrl, '=']);
    await (await browser.$('button[aria-label="Reset zoom"]')).waitForDisplayed();
    await (await browser.$('button[aria-label="Reset zoom"]')).click();
    await browser.waitUntil(() => readSettings().ui.zoom === 1);
    const bounds = await browser.execute(() => ({ width: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert.ok(bounds.width <= bounds.inner + 1, JSON.stringify(bounds));
  });
  it('opens shortcut help and closes it with Escape', async () => {
    await (await browser.$('button[aria-label="Keyboard shortcuts"]')).click();
    await (await browser.$('h1=Keyboard shortcuts')).waitForDisplayed();
    await browser.keys(Key.Escape);
  });
  it('asks before closing a shell with a running child and supports cancel', async () => {
    await chord('t'); await shellCommand('ping.exe -n 60 127.0.0.1');
    await browser.pause(700); const count = (await tabCount()); await chord('w');
    await (await browser.$('[role="alertdialog"]')).waitForDisplayed();
    await browser.keys(Key.Escape); assert.equal((await tabCount()), count);
    await chord('w'); await (await browser.$('[role="alertdialog"] .confirm')).click();
    await browser.waitUntil(async () => (await tabCount()) === count - 1);
  });
  it('shows usage from both providers and survives signed-out limits', async () => {
    await chord('u'); await (await browser.$('h1=Usage')).waitForDisplayed();
    await browser.saveScreenshot(`benchmarks/${process.env.E2E_HOST}-usage.png`);
    assert.ok((await browser.getPageSource()).includes('Codex'));
    await browser.keys(Key.Escape);
  });

  it('pins and renames a project through its context menu', async () => {
    await (await byText('button', 'portfolio2')).click({ button: 'right' });
    await (await browser.$('.menu').$('button=Pin project')).click();
    await browser.waitUntil(() => readSettings().projects.pinned.some(p => p.path.endsWith('portfolio2')));
    await (await browser.$('.project .pin')).waitForDisplayed();
    await (await byText('button', 'portfolio2')).click({ button: 'right' });
    await (await browser.$('.menu').$('button=Rename…')).click();
    await (await browser.$('input.rename')).waitForDisplayed();
    await browser.keys([Key.Ctrl, 'a']); await browser.keys('Portfolio renamed'); await browser.keys(Key.Enter);
    await (await byText('button', 'Portfolio renamed')).waitForDisplayed();
    await browser.waitUntil(() => Object.values(readSettings().projects.names).includes('Portfolio renamed'));
  });
  it('renames a session without modifying its transcript', async () => {
    await (await byText('button', 'Renamed Codex session')).click({ button: 'right' });
    await (await browser.$('.menu').$('button=Rename…')).click();
    await (await browser.$('input.rename')).waitForDisplayed();
    await browser.keys([Key.Ctrl, 'a']); await browser.keys('Codex custom name'); await browser.keys(Key.Enter);
    await (await byText('button', 'Codex custom name')).waitForDisplayed();
    await browser.waitUntil(() => Object.values(readSettings().projects.sessionNames).includes('Codex custom name'));
  });
  it('opens each provider from the agent chooser and supports cancellation', async () => {
    const count = (await tabCount());
    await chord('a'); await (await browser.$('dialog')).waitForDisplayed();
    await (await browser.$('dialog').$('button=Cancel')).click();
    assert.equal((await tabCount()), count);
    for (const provider of ['Claude', 'Codex']) {
      await chord('a'); await (await browser.$('dialog').$('button*=' + provider)).click();
      await browser.waitUntil(async () => (await tabCount()) === count + 1);
      await browser.pause(700); await chord('w');
      await browser.waitUntil(async () => (await tabCount()) === count);
    }
  });
  it('removes a deleted transcript from the live sidebar', async () => {
    unlinkSync(configFile('claude/projects/D--Coding-game-tracker-app/e2e-live.jsonl'));
    await (await byText('button', 'Renamed while running')).waitForExist({ reverse: true });
  });


  it('shows every tab in the mosaic and leaves it on a tile click', async () => {
    await browser.keys(Key.Escape);
    const count = await tabCount();
    await chord('g');
    await browser.waitUntil(async () => (await browser.$$('[data-tile]')).length === count, { timeoutMsg: 'Mosaic did not tile every tab' });
    await browser.saveScreenshot(`benchmarks/${process.env.E2E_HOST}-mosaic.png`);
    const tile = (await browser.$$('[data-tile]'))[0]; const title = await tile.getAttribute('data-tile');
    await tile.click();
    await browser.waitUntil(async () => (await browser.$$('[data-tile]')).length === 0);
    assert.equal(await shownTitle(), title);
  });
  it('starts a task in the background and stays on the current tab', async () => {
    await (await browser.$('button[role="tab"]*=Open')).click();
    const count = await tabCount(); const title = await shownTitle();
    await (await browser.$('input[aria-label="Task"]')).setValue("Count the tests, don't edit"); await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await tabCount()) === count + 1, { timeoutMsg: 'Task did not open a tab' });
    await browser.pause(700);
    assert.equal(await shownTitle(), title);
    await (await browser.$('button[role="tab"]*=Sessions')).click();
  });
  it('copies a session id through the real Windows clipboard', async () => {
    execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/sendkeys.ps1', '-ProcessId', process.env.E2E_PID, '-Keys', '{ESC}', '-SettleMs', '200'], { windowsHide: true });
    await (await byText('button', 'Codex custom name')).click({ button: 'right' });
    await (await browser.$('.menu').$('button=Copy session id')).click();
    const expected = Object.entries(readSettings().projects.sessionNames).find(([,v]) => v === 'Codex custom name')[0].replace(/^codex:/, '');
    await browser.waitUntil(() => execFileSync('pwsh', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', windowsHide: true }).trim() === expected, { timeoutMsg: 'Session id did not reach Windows clipboard' });
  });
  it('exports usage through the native Save dialog and handles Cancel', async () => {
    await chord('u'); await (await browser.$('h1=Usage')).waitForDisplayed();
    const button = await browser.$('button=Export CSV'); await button.waitForEnabled();
    const file = configFile('usage-export.csv');
    for (const cancel of [true, false]) {
      const args = ['-NoProfile', '-File', 'scripts/native-save-dialog.ps1', '-ProcessId', process.env.E2E_PID, '-Path', file];
      if (cancel) args.push('-Cancel');
      const dialog = promisify(execFile)('pwsh', args, { windowsHide: true });
      const results = await Promise.all([button.click(), dialog]);
      console.log(results[1].stdout);
      await button.waitForEnabled();
      await browser.pause(500);
    }
    await browser.waitUntil(() => { try { return readFileSync(file,'utf8').includes('codex'); } catch { return false; } }, { timeoutMsg: 'Export did not produce provider CSV data' });
    await browser.keys(Key.Escape);
  });
  it('persists tabs, custom names, notes and settings across a page reload', async () => {
    const settings = readSettings(); settings.ui.restoreTabs = true;
    writeFileSync(configFile('settings.json'), JSON.stringify(settings));
    await browser.pause(700);
    const count = (await tabCount());
    await browser.refresh();
    await browser.waitUntil(async () => (await tabCount()) === count, { timeout: 15000 });
    await (await byText('button', 'Portfolio renamed')).waitForDisplayed();
    await (await browser.$('button[role="tab"]*=Open')).click();
    await (await browser.$('.notes strong=Keep this note')).waitForDisplayed();
    await (await browser.$('.open-list').$('button*=Behaviour shell')).click();
    await (await browser.$('button[role="tab"]*=Sessions')).click();
    await shellCommand("Write-Output ('RESTORED_' + 'SHELL')"); await findOutput('RESTORED_SHELL');
  });
  it('records runtime memory after the interaction workload', async () => {
    sampleRuntime('after-workload');
    const samples = JSON.parse(readFileSync(`benchmarks/${process.env.E2E_HOST}-after-workload.json`, 'utf8')).samples;
    const tabs = (await tabCount());
    for (const sample of samples) assert.equal(sample.processes.filter(p => /^(pwsh|powershell)$/.test(p.name)).length, tabs, 'Reload left orphan shells');
    await browser.saveScreenshot(`benchmarks/${process.env.E2E_HOST}-after-workload.png`);
  });
});


afterEach(async (test) => {
 if (!browser) return;
 if (test.passed === false || test.error) {
  const name = test.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 70);
  await browser.saveScreenshot(`benchmarks/failure-${name}.png`);
  console.log('Failure focus:', await browser.execute(() => ({ tag: document.activeElement?.tagName, className: document.activeElement?.className, keys: window.__atcKeys })));
 }
 const close = await browser.$('button[aria-label="Close find"]');
 if (await close.isExisting()) await close.click();
});
