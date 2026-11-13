# Codex integration validation

Checked on Windows on 2026-09-20 with Codex CLI 0.155.1 and Claude Code 2.1.278, on the
Rust host. This is a record of that check. The Go port's test results are in
[WAILS-MIGRATION.md](WAILS-MIGRATION.md). How Codex works today is in the
[README](../README.md#codex) and [ARCHITECTURE.md](../ARCHITECTURE.md).

## Automated checks

- `npm test`: 195 TypeScript tests, 142 Rust unit tests, 10 fixture contract tests,
  10 PTY pipeline tests and 3 native PTY smoke tests passed.
- `npm run lint`: Rust formatting, Clippy and the Svelte checks passed.
- `npm run build`: the production frontend build passed.
- The installed-Codex test, normally skipped, ran separately against CLI 0.155.1. It
  checked the app-server handshake, the signed-out account error and subprocess cleanup.

The fixtures cover both transcript formats, mixed provider identities, incremental reads,
malformed and partial records, child usage, rename precedence, watcher changes, legacy
restoration, command quoting, ambiguous matching, token deduplication, cumulative resets,
partial cost totals, CSV fields and rate-limit failures.

## Native Windows checks

`npm run play` used synthetic histories and isolated CLI homes under the ignored
`playground/config` directory. It copied no personal histories or credentials.

- Claude and Codex launched alongside plain PowerShell tabs.
- The sidebar picked up a synthetic Codex conversation written outside ATC while it ran.
- Project menus offered Claude and Codex side by side.
- Both generic agent shortcuts opened the provider picker, which works from the keyboard.
  Escape returned focus to the terminal, and a typed marker reached PowerShell.
- Copy resume command included the provider command, the native ID and the isolated Codex
  home.
- A recorded completion raised a background Codex tab's attention mark. A repeated
  completion record did not raise it again.
- The Codex terminal redrew correctly after a resize.
- A restart restored mixed tabs, provider icons, their order, a custom Codex title, and an
  unbound Claude tab as an agent launch. Completions loaded from history raised nothing.
- The usage page showed each provider's error on its own, and synthetic Codex tokens with
  no cost. Plain shells and their shortcuts kept working.
- Closing the playground ended the CLI processes it had started.

## Not checked

The isolated Codex home was signed out, and Claude's usage endpoint reported an expired
login. Resume was dispatched with a synthetic ID, so resuming a real signed-in
conversation and showing live account quotas were not checked. Nor was delivery of the
Windows notification itself; the completion and the attention mark behind it were.

## Accounting fix

Mixed Codex records could include a cumulative snapshot behind the latest structured
response total. ATC read the drop as a counter reset and counted the earlier tokens
again, which produced billion-token totals and matching dollar estimates.

Structured response records now win. Older cumulative snapshots count only before a
thread's first structured record, or in threads that never have one. A regression test
with 100 responses covers lagging snapshots, deduplication, token subsets and the price.
A read-only audit of the real session that showed the bug summed its unique response ids
and matched the thread's recorded total exactly.
