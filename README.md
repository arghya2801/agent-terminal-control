# ATC — Agent Terminal Control

A Windows terminal with one project tree for Claude Code and Codex sessions.
Clicking a project opens a shell there; clicking a session resumes that conversation.

Both CLIs run in ATC's existing PowerShell and ConPTY terminals. Each CLI manages its own authentication, models, permissions, and configuration.

## Why

Resuming a Claude Code session means remembering which directory it belongs to, then
stepping through `claude --resume`'s picker to find it. ATC reads
`~/.claude/projects` directly and lists every session under the project it belongs to,
so resuming is one click.

The terminal is a real one — xterm.js over a Windows ConPTY — not a text box that
imitates a shell. Claude Code's TUI, PSReadLine, colours and Ctrl+C all behave normally.

## Requirements

- Windows 10 later (ConPTY)
- WebView2 runtime (preinstalled on Windows 11)
- PowerShell 7 (`pwsh`), falling back to Windows PowerShell
- Claude Code or Codex CLI for the corresponding agent features. Either can be absent without disabling shells or the other provider.

## Install

Three downloads on the Releases page. Pick one.

| File | What it is |
|---|---|
| `ATC_<version>_x64_en-US.msi` | [Recommended] MSI installer. Installs for all users, needs admin. Also works for deploying through Group Policy or Intune. |
| `ATC_<version>_x64-setup.exe` | NSIS installer. Per-user, no admin prompt. Closes every running `atc.exe` before installing, portable copies included. |
| `atc.exe` | The bare executable. No installer, no Start menu entry, no uninstaller. Put it anywhere and run it. |

All three are the same application. The installers do nothing but place that
executable, add a Start menu entry and register an uninstaller.

### Updating

There is no auto-update. Download the new release and run the same kind of file you
installed:

- **MSI:** run the new `.msi`. It replaces the installed version in place. Close ATC
  first, or Windows asks to close it or restart.
- **Setup exe:** run the new `setup.exe`. It also upgrades in place, and closes any
  running ATC itself.
- **`atc.exe`:** replace the file.

Stick to one installer type. The MSI installs per machine and the setup exe per user,
so switching between them leaves two separate installs. Settings are kept in every case.

The binaries are unsigned, so SmartScreen shows "Windows protected your PC" on first
run. Click **More info**, then **Run anyway**.

Settings and cache live in `%APPDATA%\Agent Terminal Control\`. Uninstalling does not
remove them; delete that folder by hand if you want them gone.


### From source

```
npm install
npm run tauri dev      # development
npm run tauri build    # produces exe, msi and nsis installer
```

Build output lands in `src-tauri/target/release/`, with the installers under
`bundle/msi/` and `bundle/nsis/`.

## Capabilities

**Sidebar**
- Projects derived from Claude and Codex transcripts, resolved to their real paths
- Sessions listed newest first, labelled by the name Claude gives the session, falling
  back to its title, the session slug, the first message, then the session id
- Filter box: matches project name, path, session name and branch
- Git branch shown per session; non-default branches highlighted
- Relative timestamps
- Live refresh — sessions appear as they are created, without a restart
- Pinned projects sort first
- A dot on every session with an open tab: pulsing while Claude works, green when it is
  waiting for you, blue when it finished in a background tab
- Right-click a project: open Claude, Codex, or a shell, rename, open in Explorer, copy
  path, pin/unpin
- Right-click a session: rename, copy session id, copy resume command, open in Explorer
- Drag the sidebar's edge to resize it; double-click to reset

**Terminal**
- Tabs, each a separate `pwsh` process, reopened on the next launch
- Clicking a project or session reuses its existing tab rather than opening a second
- Closing a tab with a running process asks first, naming what would be stopped
- Windows notification when a background session finishes while ATC is not focused
- Ask either agent outside any project, in the shared scratch directory
- Search across scrollback with match counts
- Whole-application zoom, persisted
- Sessions with no recorded working directory are shown but not launchable

**Usage**
- Independent Claude and Codex plan limits, refreshed while the page is open
- Local tokens by provider, project, model and session, with CSV export. Claude and Codex API-price estimates; unknown models remain unpriced.

**Configuration**
- Settings page in the app, and `settings.json` applied live; edits take effect without
  a restart

## Keyboard shortcuts

Application shortcuts use `Ctrl+Shift`, which neither PowerShell nor Claude Code binds.
They are intercepted before the terminal sees them, so they never reach the shell.
Everything else, including `Ctrl+C`, `Ctrl+R`, `Tab` and `Shift+Tab`, is passed through
untouched.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+B` | Toggle sidebar |
| `Ctrl+Shift+T` | New tab |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+Shift+F` | Find in terminal |
| `Ctrl+=` / `Ctrl+-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `Ctrl+Shift+P` | Filter projects and sessions |
| `Ctrl+Shift+L` | Choose Claude or Codex in this tab's project |
| `Ctrl+Shift+N` | Open a terminal in this tab's project |
| `Ctrl+Shift+A` | Choose an agent in the shared scratch directory |
| `Ctrl+Shift+R` | Rename this tab |
| `Ctrl+Shift+U` | Usage and spend |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+D` | PTY statistics overlay |
| `Ctrl+Shift+I` | Developer tools (debug builds only) |

In the find bar: `Enter` next match, `Shift+Enter` previous, `Escape` close.

## Settings

### Codex sessions and usage

ATC discovers local Codex CLI, desktop, and editor conversations, including sessions started outside ATC. The sidebar mixes both providers by recency and shows a provider icon beside each session. Archived conversations and child agents are hidden from the sidebar. Sessions without a recorded working directory remain visible but cannot be resumed.

Right-click a project for **Open in Claude** or **Open in Codex**. Generic agent shortcuts always ask which provider to use. Tab and Enter choose a provider; Escape cancels and returns focus to the terminal. The `+` button, `Ctrl+Shift+T`, and project shell buttons still open plain shells.

Configure Codex in Settings or add this block to `settings.json`:

```json
"codex": {
  "command": "codex",
  "resumeArgs": ["resume", "{session}"],
  "homeDir": null
}
```

`command` is an executable name or path, not a shell expression. Arguments are separate values. ATC quotes PowerShell arguments, including paths containing spaces or apostrophes. The Codex home resolves from `codex.homeDir`, then `CODEX_HOME`, then `%USERPROFILE%\.codex`. Discovery, launches, copied resume commands, and limit requests use that same home.

ATC names Codex sessions using your rename override, the latest name in `session_index.jsonl`, the first user message, then the native ID. Existing Claude names and saved tabs migrate automatically. Fresh agent tabs bind only when a new conversation can be identified unambiguously in the launch directory. Unbound tabs restore as fresh agent launches.

The Usage page has independent Claude and Codex limit sections and an All/Claude/Codex filter. Codex limits come from the documented [`account/rateLimits/read` app-server API](https://developers.openai.com/codex/app-server). Window durations and reset times come from its response. ATC starts the subprocess on demand and stops it after each request or when the page closes. Refreshes run every 90 seconds while the page is open.

Local token totals include linked child-agent usage. Cached input and reasoning are subsets, not extra tokens. Codex costs use standard short-context API prices verified on 2026-09-20, with separate cached-input and cache-write rates. Reasoning tokens are already included in output cost. These are baseline API equivalents, excluding tier, regional, long-context, and tool surcharges, not subscription charges. Unknown models (including internal aliases) stay unpriced. Totals containing unpriced usage are marked partial; CSV leaves unavailable costs blank. Provider-qualified session and model identities prevent collisions between the two CLIs.

This integration targets native Windows. It does not discover WSL or remote Codex histories or convert conversations between providers.

`%APPDATA%\Agent Terminal Control\settings.json` — that is
`C:\Users\<you>\AppData\Roaming\Agent Terminal Control\settings.json` — created on first
run. The gear icon in the
rail opens it. Every field is optional; missing ones take their default.

```jsonc
{
  "projects": {
    "claudeProjectsDir": null,          // null = %USERPROFILE%\.claude\projects
    "pinned": [{ "path": "D:\\Coding\\myproject", "displayName": "My Project", "order": 0 }]
  },
  "ui": {
    "sidebarWidth": 260,
    "sidebarOpen": true,
    "sessionsPerProject": 15,           // before "show all"
    "zoom": 1.0,
    "notifications": true,              // notify when a background session needs you
    "restoreTabs": true                 // reopen last session's tabs on launch
  },
  "terminal": {
    "fontFamily": "\"FiraCode Nerd Font Mono\", Consolas, monospace",
    "fontSize": 13,
    "scrollback": 10000
  },
  "claude": {
    "command": "claude",
    "resumeArgs": ["--resume", "{session}"],  // {session} is the session id
    "scratchDir": null                        // null = <config dir>\\scratch
  }
}
```

A malformed file is ignored rather than overwritten; the app keeps its current settings.

Tasks live beside it in `tasks.json`.

Usage prices come from a table shipped with the app. To price a new model, or correct a
price, before a release does, add a `pricing.json` beside `settings.json`. Its entries
win over the built-in ones, and it is read at startup:

```jsonc
{
  "claude": [{ "match": "opus-6", "input": 5.0, "output": 25.0 }],   // USD per 1M tokens, substring match
  "codex": [{ "model": "gpt-7", "input": 2.0, "cached": 0.2, "cacheWrite": 2.5, "output": 10.0 }]
}
```

## Not included

- Command palette
- Theme configuration (font family, size and scrollback are configurable; colours are not)
- Split panes
- Shells other than PowerShell
- Anything other than Windows

## How it works

Rust owns the PTY. Output is read on one thread, coalesced on an 8ms tick by another,
and sent to the webview in chunks sized against Tauri's IPC threshold. The frontend
acknowledges bytes once xterm has parsed them, which applies backpressure to the shell
rather than dropping output.

Session metadata comes from reading only the head of each transcript — enough for a
label, working directory and branch — cached against file size and mtime. The working
directory is read from inside the file, never decoded from the directory name, which is
lossy.

## Development

```
npm run test     # cargo test + vitest
npm run lint     # cargo fmt, clippy, svelte-check
npm run play     # run against fixtures, leaving real data alone
```

`scripts/` contains helpers for regenerating the icon and fixtures, capturing the window,
and sending real keystrokes to the running app for testing shortcuts.


### Isolated playground

For testing with your existing logins, histories, and theme, use `npm run tauri dev`.
The playground is for synthetic discovery/UI tests: fixture IDs are not resumable CLI
conversations, and its CLI homes start signed out. Playground tabs use separate saved
state from normal development tabs.

Run `npm run play` to copy synthetic Claude and Codex histories into `playground/config`. It creates sample project directories, points both discovery roots there, and sets `CODEX_HOME` and `CLAUDE_CONFIG_DIR` for launched CLIs. It does not load personal histories or copy credentials. New sessions and CLI state remain in this ignored directory. Fixtures cover current and older metadata, renames, desktop/editor sessions, missing cwd, child agents, and malformed or partial records.

Codex pricing sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), and [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex). The checked rates also apply to dated snapshots; unknown model variants are never matched by a broad prefix.
