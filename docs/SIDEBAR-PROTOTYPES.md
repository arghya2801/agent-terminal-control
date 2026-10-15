# Sidebar prototypes

Four prototypes for managing many agent sessions from the sidebar, each on its own
branch from `main` (0.4.3). None is merged. The next step is to pick features from all
four and combine them on one branch, then open one PR.

| Branch | Idea | Commits |
|---|---|---|
| `proto/sidebar-triage` | Open view sorted by who needs you | `54334d0` |
| `proto/sidebar-rail` | Work with the sidebar shut | `6792289` |
| `proto/sidebar-one-list` | One list instead of three views | `c8dce34`, `0326c89` |
| `proto/sidebar-mission` | Mosaic, broadcast, task box | `b3c1240` |

## Pick list

Tick what to keep, then combine. Each item names the branch it lives on.

- [ ] Open view sorted needs-you first, longest waiting first; ⇅ toggles tab order (triage)
- [ ] "waiting 12m" time in state on each row (triage)
- [ ] Peek line: the last readable line of the terminal under each row (triage)
- [ ] 5-minute output sparkline per row (triage)
- [ ] Ctrl+Shift+J jumps to the agent that has waited longest (triage)
- [ ] One rail button per open tab with a state dot, hover shows title, state and peek (rail)
- [ ] Hold Ctrl+Shift, press J to flip through waiting agents in an overlay, Alt+Tab style (rail)
- [ ] Focus mode: hold notifications for 20 minutes, then one summary (rail)
- [ ] Single list: no Sessions/Open/Scratch tabs (one-list)
- [ ] Live sessions lead their project and stay visible when it is collapsed (one-list)
- [ ] Projects with a live tab sort first; loose shells in a "Shells" group (one-list)
- [ ] Spend per session row, amber from $5 (one-list)
- [ ] Park: close an idle agent's tab, keep its row, click to resume (one-list)
- [ ] Auto-park agents idle and seen for 30 minutes (one-list)
- [ ] Ctrl+Shift+G mosaic of every tab, scaled tiles labelled by state (mission)
- [ ] Ctrl+click tabs in the Open view, type one line into all of them (mission)
- [ ] Task box: start Claude or Codex on a prompt in the background (mission)

## Shared pieces

Every branch except the triage one copied these from `proto/sidebar-triage`, so the
combined branch should start from it:

- `src/lib/triage.ts` (+ test): `triageOrder`, `nextWaiting`, `stateWord`, `peekLine`.
  `peekLine` skips Claude Code and Codex chrome with a regex marked `ponytail:`; a TUI
  change can leak status-bar text into the peek.
- `src/terminal/manager.ts`: `Tab.mark` and `Tab.markSince`, updated in `notify()`;
  `outputHistory(key)` (bytes per 10 s over 5 minutes); `screenLines(key)` (the rows on
  screen as text).
- `TabSummary.since` in `src/types.ts`, filled in `App.svelte`'s `sync()`.
- Ctrl+Shift+J is `jumpWaiting` in `src/lib/keymap.ts`. The rail branch reuses the
  action for the flip-through overlay; the mission branch replaces it with
  `toggleMosaic` (Ctrl+Shift+G).

## Per branch

### triage

- `src/sidebar/OpenList.svelte`: sorting, time in state, peek, sparkline. Rows re-read
  screen text and output history on a 5 s tick. Dragging is off while sorted.
- `src/sidebar/Sidebar.svelte`: ⇅ toggle, remembered in `localStorage` as `atc.openTriage`.

### rail

- `src/tabs/RailAgents.svelte`: rail buttons. The tooltip is built on pointer enter.
- `src/tabs/Switcher.svelte`: overlay while Ctrl+Shift+J is held. `App.svelte` closes it
  on keyup of Ctrl or Shift. Each step calls `activate()`, so previewed tabs lose their
  needs-you mark. There is no Esc-to-return.
- Focus mode lives in `App.svelte` (`toggleQuiet`, `QUIET_MS`). While on, rail dots show
  needs-you as idle and `notifyAttention` counts instead of notifying.

### one-list

- `src/sidebar/Sidebar.svelte` rewritten; `OpenList.svelte` deleted;
  `src/sidebar/LiveRow.svelte` added for live tabs with no session row.
- `App.svelte` passes `sessionSince`, `unbound`, `parked`, `onPark`. Auto-park runs on a
  60 s interval with `PARK_MS` = 30 minutes; only tabs bound to a session park.
- Costs come from `usageCosts()`, summed by `provider:sessionId`, reloaded at most once a
  minute. Parked state is in memory only and is lost on restart.
- `Ctrl+Shift+K` (switch sidebar view) still exists but does nothing visible.

### mission

- Mosaic in `src/terminal/manager.ts` (`toggleMosaic`, `mosaicLayout`). Tiles are
  full-size panes scaled with CSS `transform`, so PTYs are never resized. Labels are a
  `::after` on `[data-tile]` in `App.svelte`, coloured by `data-mark`, because xterm's
  canvas paints over borders and outlines. A capture-phase `mousedown` on each container
  picks the tile.
- `sendText(key, text)` in the manager writes the text plus Enter.
- Task box and broadcast bar are in `src/sidebar/OpenList.svelte`. `dispatch()` in
  `App.svelte` quotes the prompt for PowerShell (`'...'`, with `''` for `'`), opens the
  tab, then re-activates the previous one. The tab has to show for one frame to spawn at
  its real size.

## Verification

Done on Windows in `npm run play`:

- Each branch: `svelte-check` clean, 249 frontend tests pass. Full `npm test` and
  `npm run lint` were run on the triage branch only.
- Seen working: triage rows; rail dots and Ctrl+Shift+J; a resumed session moving to
  the top of its project; the mosaic opening, colouring and restoring.

Not verified:

- Broadcast and the task box with real agents.
- Costs: the fixture transcripts carry no token usage. Needs `npm run desktop:dev`.
- Auto-park after 30 minutes and focus mode after 20 minutes.

## Testing states in the playground

The playground's Claude and Codex are not signed in, so their tabs never report a
state. `scripts/fake-agent.ps1` sets Claude's working and idle title markers, prints
output, then stops on a question with Claude-like chrome:

```powershell
& scripts\fake-agent.ps1 -Name 'Fix login' -Work 8 -Question 'Should I run the tests?'
```

Run it in a few tabs and switch away; finishing in a background tab marks it as needing
you. The playground only runs one version at a time: Vite and Wails use fixed ports
1420 and 34115.

## Combining

1. Branch from `proto/sidebar-triage`.
2. Bring the chosen parts across from the other branches. `git checkout <branch> -- <file>`
   works for whole files; `App.svelte`, `Sidebar.svelte` and `OpenList.svelte` need hand merging.
3. Drop this file and anything not chosen. Add CHANGELOG lines. Test in the dev app.
4. Delete the `proto/sidebar-*` branches after the PR merges.
