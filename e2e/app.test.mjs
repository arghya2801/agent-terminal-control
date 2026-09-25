// Runs under `npm run test:e2e` (see run.mjs), against the fixture playground.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Key, remote } from 'webdriverio';

/** @type {import('webdriverio').Browser} */
let browser;

before(async () => {
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    capabilities: { 'tauri:options': { application: process.env.E2E_APP } },
  });
});

after(async () => {
  await browser?.deleteSession();
});

/** A chord such as Ctrl+Shift+U, pressed and released. */
async function chord(key) {
  await browser.action('key').down(Key.Ctrl).down(Key.Shift).down(key).up(key).up(Key.Shift).up(Key.Ctrl).perform();
}

const byText = (tag, text) => browser.$(`${tag}*=${text}`);

describe('ATC', () => {
  it('lists the fixture projects and opens a session in a tab', async () => {
    const session = await byText('button', 'fix the scoreboard');
    await session.waitForDisplayed({ timeout: 20_000 });
    assert.ok(await (await byText('button', 'game_tracker_app')).isDisplayed());
    await session.click();
    const tab = await browser.$('.tab.active');
    await tab.waitForDisplayed();
    await browser.waitUntil(async () => (await browser.$$('.tab')).length >= 1);
  });

  it('creates a task and links a session to it', async () => {
    await (await browser.$('button[role="tab"]*=Tasks')).click();
    await (await browser.$('button[aria-label="New task"]')).click();
    // The new task opens in rename.
    // It takes focus itself; typed rather than setValue, which holds on to an element the
    // list may re-render.
    await (await browser.$('input.rename')).waitForDisplayed();
    await browser.keys([Key.Ctrl, 'a']);
    await browser.keys('E2E task');
    await browser.keys(Key.Enter);
    await (await byText('button', 'E2E task')).waitForDisplayed();

    await (await browser.$('button[role="tab"]*=Sessions')).click();
    await (await byText('button', 'fix the scoreboard')).click({ button: 'right' });
    await (await browser.$('.menu').$('button*=E2E task')).click();

    await (await browser.$('button[role="tab"]*=Tasks')).click();
    // Re-queried each time: the row re-renders when the link is saved.
    const row = async () => (await byText('button', 'E2E task')).getText();
    await browser
      // A linked session with a tab open reads "1 open" rather than "1 session".
      .waitUntil(async () => /\b1 (session|open)\b/.test(await row()))
      .catch(async () => assert.fail(`the session was not linked; the task reads ${JSON.stringify(await row())}`));
  });

  it('opens the task panel', async () => {
    await (await byText('button', 'E2E task')).click();
    await chord('e');
    await (await browser.$('aside[aria-label="Task details"]')).waitForDisplayed();
  });

  it('opens the Usage page and closes it with Escape', async () => {
    await chord('u');
    const heading = await browser.$('h1=Usage');
    await heading.waitForDisplayed();
    await browser.keys('Escape');
    await heading.waitForDisplayed({ reverse: true });
  });
});
