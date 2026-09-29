# Go/Wails migration and measurements

Rust baseline: `5b9d6a1b0c735a8336549bfec8415a0cb031025e` (0.3.1). Measured on
29 September 2026 on one machine: Windows 11 build 26200, Ryzen 5 4600H (6 cores,
12 threads), 16 GB RAM, Go 1.26.5, Rust 1.98.1, Wails 2.16.0, Node 24.13.1,
WebView2 151.0.4129.86.

The port makes backend builds much faster and lighter. It makes the running application
slightly heavier: similar working set, more private memory, and a larger executable.

## Build cost

Each build ran inside a Windows Job Object, which accounts CPU time and peak committed
memory for every descendant process exactly, including the hundreds of short-lived
`rustc`, `link.exe` and `compile.exe` processes a build spawns. Rust was built from the
baseline commit in a separate worktree, Go from the port. Both embed the same prebuilt
frontend, so the frontend's cost is excluded. "Clean" means an empty target directory
or `GOCACHE`; downloaded crates and modules stayed cached. Go rebuilds its standard
library on a clean build; Rust uses its precompiled one. An edit changes one string in
the main backend file.

Release builds, as shipped (Rust: `cargo build --release`, LTO with one codegen unit;
Go: `wails build`):

| | Rust/Tauri | Go/Wails | Go is |
|---|---:|---:|---:|
| Clean: wall time | 436 s | 58 s | 7.5x faster |
| Clean: CPU time | 1,102 CPU-s | 82 CPU-s | 13x less |
| Clean: peak committed memory | 5.75 GiB | 1.22 GiB | 4.7x less |
| One edit: wall time | 171–180 s | 2.7–2.8 s | about 63x faster |
| One edit: peak committed memory | 1.35 GiB | 405 MiB | 3.4x less |
| No-op | 0.7–1.7 s | 1.0–1.1 s | about the same |

Development builds (Rust: `cargo build`; Go: Wails' development flags,
`-gcflags "all=-N -l" -tags dev,devtools`):

| | Rust debug | Go dev | Go is |
|---|---:|---:|---:|
| Clean: wall time | 234 s | 17 s | 14x faster |
| Clean: CPU time | 771 CPU-s | 66 CPU-s | 12x less |
| Clean: peak committed memory | 4.9 GiB | 1.04 GiB | 4.7x less |
| One edit: wall time | 34–37 s | 3.3 s | about 11x faster |
| One edit: peak committed memory | 1.4 GiB | 367 MiB | 3.9x less |

Edits and no-ops were each run twice; clean builds once. A release edit is slow in Rust
because LTO with a single codegen unit relinks the whole program on one core.

With the development server running, a Go source edit appeared in a relaunched native
window in about 5 seconds, including Wails' debounce, the build and window startup.

## Runtime cost

Each release binary was launched three times with a fresh fixture profile and fresh
WebView2 data, opening one PowerShell tab, with no input. Memory and CPU cover the whole
process tree (ATC, WebView2, the shell), averaged over 20 one-second samples after 15
seconds of settling. Idle CPU is a percentage of one core.

| | Rust/Tauri | Go/Wails |
|---|---:|---:|
| Executable size | 5.25 MB | 12.35 MB |
| Launch to shell running (median) | 5.2 s | 6.6 s |
| Window first visible | 0.1–0.5 s | 5.0–7.9 s |
| Private memory, whole tree | 224–234 MiB | 272–283 MiB |
| Working set, whole tree | 480–483 MiB | 489–491 MiB |
| Host process alone, private memory | 6–7 MiB | 56 MiB |
| Idle CPU, whole tree | 1.1–1.8% | 3.3–5.5% |

Tauri shows its window frame before the page loads; Wails shows it once the page is
ready, so the window itself appears later although the shell starts only about a second
later. Most idle CPU in the Go build came from an 8 ms output-flush ticker that ran for
the life of every terminal; it now runs only while output is pending, which took the
host from 5.1% to about 3.5% of a core. The remainder has not been attributed yet.

Earlier workload runs (13 sessions, three shells, a 3,000-line burst, split view) showed
the same shape: working set within 1%, private memory 31–41 MiB higher for Go.

User-visible checks, by native window capture: split view, idle and after-workload
states, Settings and Usage pages, Claude Code 2.1.284 and Codex CLI 0.156.1 running
inside ConPTY, and real Claude and Codex onboarding launched through the agent chooser
with isolated config directories (reproduce with `node scripts/check-native-agents.mjs`).
No account login or paid prompt was sent.

## Validation

| Layer | Result and scope |
|---|---|
| Frontend unit tests | 247 passing tests in 25 files: shortcuts, task/session linking, grouping, ordering, restore state, themes, costs, dates, Markdown, OSC52, terminal helpers and desktop transport |
| Go unit/integration tests | 185 top-level tests, all passing under the race detector; 2 are opt-in (`ATC_TEST_CODEX`, `ATC_AUDIT_CODEX_HOME`) as they were in Rust. Real ConPTY processes, UTF-8 boundaries, serialized-size chunking, 3 MB backpressure/recovery, process-tree termination, settings/tasks validation and migration, concurrent atomic saves, incremental indexing/accounting, filesystem-watch relevance and a frozen Rust fixture contract |
| Rust test parity | Every one of the 187 Rust tests has a Go counterpart, ported case by case into `internal/core/{session,project,cache,cost,settings}_test.go`, `internal/pty/pump_test.go` and `parity_test.go`. Two Rust cases have no Go behaviour to test: `cmd.exe` receiving no PowerShell flags (Go only runs PowerShell) and a blank shell setting falling back to PowerShell |
| Native desktop E2E | 32/32 passing, no skips; real WebView2, real PowerShell and filesystem watchers |
| Static checks | `go vet`, Svelte/TypeScript check: zero errors and warnings |
| Production build | Portable Go/Wails executable built and launched |
| Packaging | MSI and NSIS built; EXE version metadata and MSI File, Shortcut, Property and Upgrade tables inspected |

The E2E suite covers session open/reuse/filter/rename/live create/delete; task create,
link, status, Markdown, external edits, Git branches/refresh and delete confirmation;
terminal commands, Unicode, large output, tab naming/cycling/dragging, split/focus,
busy-close cancel/confirm; sidebar, themes/font/grouping, zoom, shortcut help; usage
from both fixture providers, signed-out errors, native CSV Save/Cancel and Windows
clipboard; page reload persistence and shell cleanup. Helpers only target the owned
fixture process and verify foreground ownership before typing native keys.

Provider protocol tests exercise the Codex app-server handshake and cancellation
using a child process, plus Claude success/authentication/malformed/expired responses
using an HTTP transport fixture. E2E agent commands use harmless fixture commands;
the additional native checks launch the actual installed CLIs through onboarding.
Live authenticated provider responses, paid agent work, notification delivery under
all Windows focus settings, installer upgrade execution and remote GitHub CI were
not exercised. Installers were not run over the user's installed ATC.

This is substantial automated and hands-on coverage, not a claim that every possible
interaction or Windows configuration is proven.

### Issues found and fixed during validation

- Task-note keystrokes were lost when own saves echoed stale state through watchers.
  Own saves now update comparison snapshots without replacing the active editor.
- Concurrent reads could transiently block Windows atomic rename. Saves now retry
  sharing/access conflicts and serialize against watcher reloads.
- Full-page reloads could leave old shells alive. The document identity handshake
  disposes them before restoration, while preserving shells during ordinary HMR.
- UTF-8 output acknowledgements now count bytes; PTY tests verify lossless recovery
  after output backpressure and delivery before exit.
- Wails' recursive dev watcher traversed transient WebView/Rust build directories.
  A small generated Go source mirror makes reloads reliable in this repository.
- Export disables its button while a native dialog/write is in progress, preventing
  overlapping dialogs. Native tests exercise cancellation and saving an actual CSV.

Found by review and by porting the Rust tests:

- Moving tasks out of an invalid `settings.json` saved defaults over it. The move now
  only happens when settings loaded cleanly, as in Rust.
- An 8 ms flush ticker ran for every idle terminal; it now runs only with output pending.
  A PTY reader could also block forever after exit because its stop channel was never closed.
- Output was chunked by raw bytes, so escape-dense TUI redraws produced events several
  times the intended size. Chunks are now bounded by their serialized JSON length.
- The session cache re-read a live transcript's 512 KiB head on every append, and rewrote
  its disk cache on every scan when a Codex file had no metadata. Appends now refresh
  recency and the tail name only, as in Rust.
- The file watcher rescanned on any `.jsonl` write, including subagent transcripts that
  write constantly. It now matches Rust's relevance rules.
- CSS zoom made xterm mis-measure its rows, leaving a blank band above the prompt. The
  terminal area now cancels the zoom and scales its font instead.

## Migration and artifacts

The Go host replaces Tauri IPC, ConPTY handling, settings/tasks, filesystem watching,
Claude/Codex discovery, token accounting, plan-limit clients and desktop integrations.
The Svelte UI, xterm behaviour and existing frontend unit tests remain. The Rust
sources were removed once their tests had Go counterparts.

Settings, tasks, names, pins and transcript paths retain the existing on-disk formats.
Wails uses a separate WebView profile under the same config directory. Tauri-origin
localStorage, including open tabs, is not imported: users reopen their tabs once.
Subsequent Wails restarts restore them. Developer tools move to `Ctrl+Shift+F12` in
debug builds. PTY support and installers target Windows.

Generated artifacts (version 0.3.1):

- `build/bin/atc.exe`, 12,347,904 bytes.
- `build/bin/ATC_0.3.1_x64-setup.exe`, 3,816,878 bytes.
- `build/bin/ATC_0.3.1_x64_en-US.msi`, 5,111,808 bytes.

The MSI retains the original upgrade identity. WiX emits ICE61 because same-version
replacement is intentionally enabled for migrating 0.3.1 from Rust to Go. The MSI
shortcut resolves to `[INSTALLDIR]atc.exe`; EXE FileVersion/ProductVersion are 0.3.1.
The release workflow refuses a tag that disagrees with `package.json` or `wails.json`.
