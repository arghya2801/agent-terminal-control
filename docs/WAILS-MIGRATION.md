# Moving ATC from Rust/Tauri to Go/Wails

In 0.4.0 the desktop host moved from Rust and Tauri to Go and Wails. The window
contents did not change. The sidebar, terminals and every page are the same Svelte and
xterm.js code. What changed is the program underneath, the part that starts shells,
reads transcripts, counts tokens and saves settings.

Go is far cheaper to build and slightly more expensive to run.
A one-line change used to take three minutes to turn into a release build and now takes
three seconds. The installed app uses about 50 MB more memory and its window appears a
few seconds later.

## Three different costs

This report measures three things. They are easy to mix up, so here is what each one
means.

| What | When it happens | Who waits for it |
|---|---|---|
| Building a release | Once per release, on CI | Whoever cuts the release |
| Building while developing | Every time a Go file is saved | The developer, many times a day |
| Running the app | Whenever ATC is open | Every user |

**Building a release** compiles the optimized `atc.exe` that goes into the installer.
The compiler works hard to make that program small and fast, so the build itself is slow.

**Building while developing** compiles a quick, unoptimized copy so a change shows up in
a window right away. That copy is never shipped. This is the build cost you feel day to
day, and it is where Go helps most.

**Running the app** is what the finished program costs on a user's machine: memory, CPU
and startup time. It was measured with the release build, the same `atc.exe` users
install. So the first row is the cost of making the program, and the third is the cost
of using it.

## Test machine

Everything was measured on 29 September 2026 on one laptop: Windows 11 build 26200, a
Ryzen 5 4600H with 6 cores and 12 threads, 16 GB of RAM, Go 1.26.5, Rust 1.98.1, Wails
2.16.0, Node 24.13.1 and WebView2 151.0.4129.86. The Rust numbers come from commit
`5b9d6a1`, the last Rust release, 0.3.1. Numbers on another machine will differ, but the
ratios should hold.

## Building a release

Rust built with `cargo build --release`, which for ATC uses link-time optimization with
a single code-generation unit. Go built with `wails build`. Both embedded the same
prebuilt frontend, so these numbers cover only the host.

| | Rust | Go | Difference |
|---|---:|---:|---:|
| From scratch: time | 436 s | 58 s | Go 7.5x faster |
| From scratch: CPU time | 1,102 CPU-s | 82 CPU-s | Go uses 13x less |
| From scratch: peak memory | 5.75 GiB | 1.22 GiB | Go uses 4.7x less |
| After a one-line change: time | 171 to 180 s | 2.7 to 2.8 s | Go about 63x faster |
| After a one-line change: peak memory | 1.35 GiB | 405 MiB | Go uses 3.4x less |
| Nothing changed | 0.7 to 1.7 s | 1.0 to 1.1 s | About the same |

The one-line change is where Rust hurts. Link-time optimization with one code-generation
unit re-optimizes the whole program on a single core, so even a changed string costs
three minutes.

## Building while developing

Rust built with a plain `cargo build`. Go built with the flags Wails uses in development
mode, `-gcflags "all=-N -l" -tags dev,devtools`, which turn off optimization and add the
developer tools.

| | Rust | Go | Difference |
|---|---:|---:|---:|
| From scratch: time | 234 s | 17 s | Go 14x faster |
| From scratch: CPU time | 771 CPU-s | 66 CPU-s | Go uses 12x less |
| From scratch: peak memory | 4.9 GiB | 1.04 GiB | Go uses 4.7x less |
| After a one-line change: time | 34 to 37 s | 3.3 s | Go about 11x faster |
| After a one-line change: peak memory | 1.4 GiB | 367 MiB | Go uses 3.9x less |

With `npm run desktop:dev` running, a saved Go change shows up in a relaunched window in
about 5 seconds. That includes Wails noticing the save, the build and the window starting.
Frontend changes reload in place through Vite without a rebuild, same as before.

### How the builds were measured

Each build ran inside a Windows Job Object. The job adds up CPU time and peak memory for
every process the build starts, including the hundreds of short-lived `rustc`,
`link.exe` and `compile.exe` processes. An earlier measurement polled the process list
every 100 ms instead. It missed many of those short processes and reported Go's peak
memory at 678 MiB, about half the real figure.

"From scratch" means an empty Rust target directory or an empty Go build cache.
Downloaded crates and modules stayed on disk. Go rebuilds its standard library in that
case, and Rust uses a precompiled one, so the comparison slightly favours Rust. The
one-line change edits a string in the main host file. Changes and no-op builds ran
twice each, and builds from scratch ran once.

## Running the app

Each release `atc.exe` was started three times with a fresh set of fixture sessions and
a fresh WebView2 profile. Each start opened one PowerShell tab, and nobody typed
anything. After 15 seconds, the measurement took 20 samples one second apart, covering
ATC, its WebView2 processes and the shell together. Idle CPU is a percentage of one core.

| | Rust | Go |
|---|---:|---:|
| Size of `atc.exe` | 5.25 MB | 12.35 MB |
| Launch until the shell is running, median | 5.2 s | 6.6 s |
| Launch until the window appears | 0.1 to 0.5 s | 5.0 to 7.9 s |
| Private memory, everything together | 224 to 234 MiB | 272 to 283 MiB |
| Working set, everything together | 480 to 483 MiB | 489 to 491 MiB |
| Private memory, ATC's own process | 6 to 7 MiB | 56 MiB |
| Idle CPU, everything together | 1.1 to 1.8% | 3.3 to 5.5% |

Most of the memory belongs to WebView2, which both versions use, so the totals stay
close. Go's own process is larger because the Go runtime and garbage collector carry
their own memory. A longer run with 13 sessions, three shells, a 3,000-line burst of
output and split view showed the same pattern: working set within 1%, private memory 31
to 41 MiB higher for Go.

The window timing looks worse than it is. Tauri shows an empty frame straight away and
fills it in later. Wails keeps the window hidden until the page has loaded. The shell
itself starts only about a second later in Go.

Idle CPU was worse still before 0.4.0 shipped. Each terminal ran a timer that woke the
app 125 times a second even with no output. The timer now runs only while output is
waiting, which took ATC's own process from 5.1% to about 3.5% of a core. The rest of the
gap has not been tracked down yet.

## What was tested

| Area | Result |
|---|---|
| Frontend unit tests | 247 pass, covering shortcuts, tasks and sessions, grouping and ordering, restoring tabs, themes, costs, dates, Markdown, OSC 52, terminal helpers and the desktop bridge |
| Go tests | 185 pass under the race detector. Two more run only when `ATC_TEST_CODEX` or `ATC_AUDIT_CODEX_HOME` is set, as they did in Rust |
| Parity with the Rust tests | All 187 Rust tests have a Go version, in `internal/core/*_test.go`, `internal/pty/pump_test.go` and `parity_test.go`. Two Rust cases test behaviour Go does not have: `cmd.exe` getting no PowerShell flags, since Go only starts PowerShell, and a blank shell setting falling back to PowerShell |
| Rust output contract | `fixtures/rust-contract.json` holds what the Rust version produced for the fixture sessions and costs. The Go tests must produce the same thing |
| End-to-end tests | 32 of 32 pass against a real WebView2 window, real PowerShell and real file watching |
| Static checks | `go vet` and the Svelte type check report nothing |
| Installers | The MSI and NSIS installers build, and their version data, files, shortcut and upgrade settings were inspected |

The end-to-end suite opens, reuses, filters, renames, creates and deletes sessions. It
creates tasks, links them, changes their status, edits their notes, lists Git branches
and confirms deletes. In the terminal it runs commands, prints Unicode and large output,
names, cycles and drags tabs, splits panes and confirms closing a busy tab. It also
covers the sidebar, themes, fonts, grouping, zoom, the shortcut page, usage from both
providers, signed-out errors, the CSV save dialog, the Windows clipboard, and reloading
the page without losing state or leaking shells.

The provider tests run the Codex app-server handshake against a stand-in process and
feed the Claude usage client good, unauthorized, malformed and expired responses.
Real Claude Code and Codex onboarding also ran inside ATC, with throwaway config folders.

Some things were not tested: signed-in provider responses, paid agent work,
notifications under every Windows focus setting, and running the installer over an
existing install. CI now runs the Go tests on GitHub, but the end-to-end tests only
run locally because they need an interactive Windows desktop.

## Bugs found along the way

Testing the Go host turned up these, all fixed before 0.4.0:

- Typing in task notes lost keystrokes when ATC's own save came back through the file
  watcher with older text.
- Windows sometimes refused to replace a file while another reader had it open. Saves
  now retry.
- A full page reload could leave the old shells running.
- Output acknowledgements counted characters instead of bytes, which broke flow
  control for non-ASCII output.
- Wails' development watcher tripped over temporary WebView folders. `npm run
  desktop:dev` now points Wails at a small mirror of the Go sources instead.
- Clicking Export twice could open two save dialogs.

Porting the Rust tests and reviewing the port found more:

- Moving tasks out of a `settings.json` that failed to load wrote default settings over
  the user's file. Rust never touched a file it could not load, and now Go doesn't either.
- The 125-times-a-second terminal timer described above. A terminal's reader could also
  hang forever after its shell exited, because nothing told it to stop.
- Output was split into pieces by byte count. Colour codes grow six times larger once
  encoded for the page, so busy TUI output produced pieces far over the intended size.
  Pieces are now sized by their encoded length.
- ATC re-read the first 512 KiB of a live session's transcript every time Claude wrote
  to it. Rust only re-read the end, to catch a rename. Go now does the same.
- Every write to a subagent transcript made the sidebar rescan. Those files change
  constantly during agent work, and they never affect the sidebar.
- At any zoom other than 100%, a blank band appeared above the prompt. Wails cannot
  change the page zoom after startup, so ATC zooms with CSS, which confused the
  terminal's measurements. The terminal now undoes the CSS zoom and scales its font
  instead.

## What moved and what carried over

The Go host now does everything the Rust one did: talking to the page, running shells
through ConPTY, settings and tasks, file watching, finding Claude and Codex sessions,
counting tokens, reading plan limits, and desktop features like the save dialog and
notifications. The Rust code is gone. Its tests live on in Go.

Settings, tasks, session names, pinned projects and transcript paths use the same files
and formats as before. Open tabs are the exception. Wails keeps its own WebView profile,
so tabs saved by the Rust version are not restored the first time 0.4.0 starts. After
that, restarts restore them as usual. Developer tools now open with `Ctrl+Shift+F12` in
development builds. Everything still targets Windows only.

## Installers

The 0.4.0 release job produced:

- `atc.exe`, 12,354,048 bytes, the portable build
- `ATC_0.4.0_x64-setup.exe`, 3,814,287 bytes, the NSIS installer
- `ATC_0.4.0_x64_en-US.msi`, 5,107,712 bytes

The MSI keeps the upgrade code from the Rust releases, so installing it replaces an
existing ATC instead of adding a second copy. It also allows replacing the same version,
which let 0.3.1 test builds of the Go host install over the 0.3.1 Rust release. WiX warns
about that setting with ICE61, which is expected. The release job refuses to build if
the tag does not match the version in both `package.json` and `wails.json`.
