# Codex integration validation

Validated on Windows on 2026-09-20, using Codex CLI 0.155.1 and Claude Code 2.1.278.

## Automated checks

- `npm test`: 195 TypeScript tests, 142 Rust unit tests, 10 fixture contract tests,
  10 PTY pipeline tests, and 3 native PTY smoke tests passed.
- `npm run lint`: Rust formatting, Clippy, and Svelte checks passed.
- `npm run build`: production frontend build passed.
- The normally ignored installed-Codex test was run separately against CLI 0.155.1.
  It verified the app-server handshake, the signed-out account error, and subprocess cleanup.

Fixtures cover both transcript formats, mixed provider identities, incremental reads,
malformed and partial records, child usage, rename precedence, watcher changes,
legacy restoration, command quoting, ambiguous matching, token deduplication,
cumulative resets, partial cost totals, CSV fields, and rate-limit failures.

## Native Windows checks

`npm run play` used synthetic histories and isolated CLI homes under the ignored
`playground/config` directory. No personal histories or credentials were copied.

- Claude and Codex launched alongside plain PowerShell tabs.
- The mixed sidebar discovered a synthetic externally written Codex conversation live.
- Project menus offered adjacent Claude and Codex actions.
- Both generic agent shortcuts opened the keyboard-accessible picker. Escape returned
  focus to the terminal; a typed marker confirmed input reached PowerShell.
- Copy resume command included the provider command, native ID, and isolated Codex home.
- Recorded completion changed a background Codex tab's attention indicator. A repeated
  completion record did not raise it again.
- Resizing redrew the Codex terminal correctly.
- Restart restored mixed tabs, provider icons, ordering, a custom Codex title, and an
  unbound Claude tab as an agent launch. Loaded completion history stayed quiet.
- Usage rendered independent provider errors and synthetic Codex tokens with unavailable
  cost. Plain-shell creation and shortcuts continued to work.
- Closing the playground cleaned up its owned CLI processes.

## Remaining authenticated checks

The isolated Codex home was signed out; Claude's usage endpoint reported an expired
login. Resume command dispatch was checked with a synthetic ID, but successfully
resuming an authenticated real conversation and displaying live account quotas were
not verified. OS notification delivery was not separately verified; the underlying
completion transition and attention indicator were checked.
