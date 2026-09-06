# ATC — Agent Terminal Control

A Windows terminal with a sidebar listing your Claude Code projects and sessions.
Clicking a project opens a shell there; clicking a session resumes that conversation.

ATC does not modify Claude Code or wrap it. It decides what gets launched and where.

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
- Claude Code, for the session features

## Install

Download the installer from Releases, or run from source:

```
npm install
npm run tauri dev      # development
npm run tauri build    # produces exe, msi and nsis installer
```

The binaries are unsigned, so SmartScreen warns on first run.

## Capabilities

**Sidebar**
- Projects derived from `~/.claude/projects`, resolved to their real paths
- Sessions listed newest first, labelled by Claude's own session title, falling back to
  the session slug, the first message, then the session id
- Git branch shown per session; non-default branches highlighted
- Relative timestamps
- Live refresh — sessions appear as they are created, without a restart
- Pinned projects sort first
- Right-click a project: open in Explorer, copy path, pin/unpin
- Right-click a session: copy session id, copy resume command, open in Explorer

**Terminal**
- Tabs, each a separate `pwsh` process
- Clicking a project or session reuses its existing tab rather than opening a second
- Closing a tab with a running process asks first
- Search across scrollback with match counts
- Whole-application zoom, persisted
- Sessions with no recorded working directory are shown but not launchable

**Configuration**
- `settings.json` is applied live; edits take effect without a restart
- No settings UI

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
| `Ctrl+Shift+D` | PTY statistics overlay |
| `Ctrl+Shift+I` | Developer tools (debug builds only) |

In the find bar: `Enter` next match, `Shift+Enter` previous, `Escape` close.

## Settings

`%APPDATA%\dev.arghya.atc\settings.json`, created on first run. The gear icon in the
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
    "zoom": 1.0
  },
  "terminal": {
    "fontFamily": "\"FiraCode Nerd Font Mono\", Consolas, monospace",
    "fontSize": 13,
    "scrollback": 10000
  },
  "claude": {
    "command": "claude",
    "resumeArgs": ["--resume", "{session}"]   // {session} is the session id
  }
}
```

A malformed file is ignored rather than overwritten; the app keeps its current settings.

## Not included

- Command palette
- Theme configuration (font family, size and scrollback are configurable; colours are not)
- Renaming sessions
- Restoring tabs between launches
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

## Licence

Not yet chosen.
