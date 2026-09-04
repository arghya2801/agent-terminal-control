// Generates fixtures/claude-projects/ — a miniature of ~/.claude/projects.
//
// These are SYNTHETIC rather than scrubbed copies of real transcripts. Real session
// files contain private conversation content, and hand-controlled fixtures let each
// file encode exactly one edge case, named in its comment below. The structure mirrors
// what was observed in real local data (see SESSION.md > Gotchas).
//
//   node scripts/make-fixtures.mjs
//
// Run this only to regenerate; the output is committed and is what tests read.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'claude-projects');

/** A `file-history-snapshot` line — these appear in runs and push the first human
 *  message deep into the file. Padded so the runs cost realistic bytes. */
const snapshot = (i) =>
  JSON.stringify({
    type: 'file-history-snapshot',
    messageId: `snap-${i}`,
    snapshot: { messageId: `snap-${i}`, trackedFileBackups: {}, pad: 'x'.repeat(2000) },
    isSnapshotUpdate: false,
  });

/** A user turn. `human: false` produces the slash-command/caveat echoes that must NOT
 *  be picked up as the first real message. `blocks: true` emits `content` as an array
 *  of text blocks instead of a bare string — both shapes occur in real data. */
const userLine = (o) => {
  const { text, cwd, branch = 'main', slug, human = true, meta = false, sidechain = false, blocks = false } = o;
  return JSON.stringify({
    parentUuid: null,
    isSidechain: sidechain,
    type: 'user',
    message: { role: 'user', content: blocks ? [{ type: 'text', text }] : text },
    ...(meta ? { isMeta: true } : {}),
    ...(human ? { origin: { kind: 'human' }, promptSource: 'typed' } : {}),
    uuid: `u-${Math.abs(hash(text))}`,
    timestamp: '2026-08-20T10:00:00.000Z',
    cwd,
    ...(branch ? { gitBranch: branch } : {}),
    ...(slug ? { slug } : {}),
    userType: 'external',
  });
};

const aiTitle = (t) => JSON.stringify({ type: 'ai-title', aiTitle: t });
const mode = () => JSON.stringify({ type: 'mode', mode: 'normal' });

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

function write(rel, lines, { truncateLast = false } = {}) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  let body = lines.join('\n') + '\n';
  if (truncateLast) body = body.slice(0, -30); // chop mid-JSON, as a killed process leaves it
  writeFileSync(p, body, 'utf8');
  return p;
}

rmSync(ROOT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// D--Coding-game-tracker-app
// The mangled directory name is LOSSY: the real path uses an underscore
// (game_tracker_app) which the directory name cannot represent. Resolving these
// sessions to the right project proves we read `cwd` and never decode the dir name.
// ---------------------------------------------------------------------------
const GT = 'D:\\Coding\\game_tracker_app';

// Case: aiTitle present -> highest label precedence.
write('D--Coding-game-tracker-app/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl', [
  mode(),
  aiTitle('Game tracker professional grade'),
  userLine({ text: 'make the tracker feel professional', cwd: GT, slug: 'brave-humming-turing' }),
]);

// Case: no aiTitle, slug present -> falls through to slug.
write('D--Coding-game-tracker-app/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.jsonl', [
  mode(),
  userLine({ text: 'add a stats page', cwd: GT, slug: 'quiet-cuddling-lampson', branch: 'feat/stats' }),
]);

// Case: subagent transcripts live beside the session file and MUST be excluded.
// Depth-1 enumeration only, or this project reports 4 sessions instead of 3.
write('D--Coding-game-tracker-app/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb/subagents/agent-explore-1.jsonl', [
  mode(),
  userLine({ text: 'explore the repo', cwd: GT }),
]);

// Case: no aiTitle, no slug, and a run of snapshots pushes the first human message to
// line 12 / ~24KB. Also exercises the non-human lines that must be skipped, and the
// block-array content shape.
write('D--Coding-game-tracker-app/cccccccc-3333-4333-8333-cccccccccccc.jsonl', [
  mode(),
  userLine({ text: '<local-command-caveat>Caveat: ...</local-command-caveat>', cwd: GT, human: false, meta: true }),
  userLine({ text: '<command-name>/plan</command-name>', cwd: GT, human: false }),
  ...Array.from({ length: 8 }, (_, i) => snapshot(i)),
  userLine({ text: 'fix the scoreboard sort order please', cwd: GT, blocks: true }),
]);

// ---------------------------------------------------------------------------
// D--Coding-portfolio2
// ---------------------------------------------------------------------------
const P2 = 'D:\\Coding\\portfolio2';

// Case: first human message is "." — too short to be a useful label, so the label
// must fall all the way through to the uuid prefix.
write('D--Coding-portfolio2/dddddddd-4444-4444-8444-dddddddddddd.jsonl', [
  mode(),
  userLine({ text: '.', cwd: P2 }),
]);

// Case: the final line is truncated mid-JSON (process killed while appending).
// The parser must bail quietly and still return everything it read before that.
write(
  'D--Coding-portfolio2/eeeeeeee-5555-4555-8555-eeeeeeeeeeee.jsonl',
  [mode(), aiTitle('Portfolio refresh'), userLine({ text: 'refresh the portfolio', cwd: P2 }), snapshot(0)],
  { truncateLast: true },
);

// Case: the `ai-title` line sits BELOW the first human turn, and that first turn is
// the useless "." message. A parser that stops as soon as it has a cwd plus any first
// message never reaches the real title and falls back to the uuid. Mirrors a real
// local transcript.
write('D--Coding-portfolio2/1a1a1a1a-8888-4888-8888-1a1a1a1a1a1a.jsonl', [
  mode(),
  userLine({ text: '.', cwd: P2 }),
  ...Array.from({ length: 3 }, (_, i) => snapshot(i)),
  aiTitle('Run Astro portfolio with pnpm'),
  userLine({ text: 'now actually do the thing', cwd: P2 }),
]);

// ---------------------------------------------------------------------------
// D--Coding-deleted-project
// Case: cwd points at a directory that no longer exists. Must show as exists:false,
// render dimmed, and never be used as a shell cwd.
// ---------------------------------------------------------------------------
write('D--Coding-deleted-project/ffffffff-6666-4666-8666-ffffffffffff.jsonl', [
  mode(),
  aiTitle('Long gone experiment'),
  userLine({ text: 'scaffold the thing', cwd: 'D:\\Coding\\deleted_project_xyz' }),
]);

// ---------------------------------------------------------------------------
// D--Coding-headless
// Case: no `cwd` anywhere within the parse budget (300 lines / 512KiB). Must land in
// the catch-all "Unknown" group with low path confidence — never inventing a path.
// ---------------------------------------------------------------------------
write(
  'D--Coding-headless/99999999-7777-4777-8777-999999999999.jsonl',
  Array.from({ length: 320 }, (_, i) => snapshot(i)),
);

// ---------------------------------------------------------------------------
// Case: a project directory containing no .jsonl at all — must not appear.
// ---------------------------------------------------------------------------
mkdirSync(join(ROOT, 'D--Coding-empty'), { recursive: true });

console.log(`fixtures written to ${ROOT}`);
