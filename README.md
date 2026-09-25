# ATC — Agent Terminal Control

A Windows terminal with one project tree for Claude Code and Codex sessions.
Clicking a project opens a shell there; clicking a session resumes that conversation.
Local tasks tie branches and sessions together, and a Usage page shows plan limits and
what the work would have cost at API prices.

Both CLIs run in ATC's own PowerShell and ConPTY terminals. Each CLI manages its own
authentication, models, permissions and configuration.

## Why

Resuming a Claude Code session means remembering which directory it belongs to, then
stepping through `claude --resume`'s picker to find it. ATC reads
`~/.claude/projects` (and Codex's history) directly and lists every session under the
project it belongs to, so resuming is one click.

The terminal is a real one — xterm.js over a Windows ConPTY — not a text box that
imitates a shell. Claude Code's and Codex's TUIs, PSReadLine, colours and Ctrl+C all
behave normally.

## Requirements

- Windows 10 1809 or later (ConPTY)
- WebView2 runtime (preinstalled on Windows 11)
- PowerShell 7 (`pwsh`), falling back to Windows PowerShell
- Claude Code or the Codex CLI for the corresponding agent features. Either can be
  absent without disabling shells or the other provider.
- `git` on `PATH` for task branch lists

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
so switching between them leaves two separate installs. Settings and tasks are kept in
every case. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

The binaries are unsigned, so SmartScreen shows "Windows protected your PC" on first
run. Click **More info**, then **Run anyway**.

Settings, tasks and cache live in `%APPDATA%\Agent Terminal Control\`. Uninstalling does
not remove them; delete that folder by hand if you want them gone.

### From source

```
npm install
npm run tauri dev      # development
npm run tauri build    # produces exe, msi and nsis installer
```

Build output lands in `src-tauri/target/release/`, with the installers under
`bundle/msi/` and `bundle/nsis/`.

## Capabilities

**Sidebar: sessions**
- Projects derived from Claude and Codex transcripts, resolved to their real paths, with
  a provider icon on each session
- Sessions listed newest first, labelled by the name the agent gives the session, falling
  back to its title, the first message, then the session id
- Filter box (`Ctrl+Shift+P`): matches project name, path, session name and branch
- Git branch shown per session; optionally group sessions by branch, or group subfolders
  under the project containing them
- Live refresh — sessions appear as they are created, without a restart
- Pinned projects sort first
- A dot on every session with an open tab: pulsing while the agent works, green when it
  is waiting for you, blue when it finished in a background tab
- Right-click a project: open Claude, Codex or a shell, rename, open in Explorer, copy
  path, pin/unpin
- Right-click a session: rename, copy session id, copy resume command, open in Explorer,
  make a task from it or link it to one
- Full keyboard use: Down from the filter box (or Tab) enters the list, arrows move and
  expand, Enter opens, `Shift+F10` or the Menu key opens the context menu, Esc returns to
  the terminal
- Drag the sidebar's edge to resize it; double-click to reset

**Sidebar: tasks** (`Ctrl+Shift+K` switches views)
- Local to-dos, grouped as In progress, To do and Done, optionally tied to a project and
  its branches
- Sessions that ran on a task's branches are suggested for linking; nothing is linked
  automatically
- A task panel (`Ctrl+Shift+E`) with status, project, a branch picker, linked sessions and
  Markdown notes
- Reorder within a group by dragging, or with `Alt+Up` / `Alt+Down`

**Terminal**
- Tabs, each a separate `pwsh` process, reopened on the next launch; drag to reorder
- Split panes: two terminals side by side (`Ctrl+Shift+\`), `Ctrl+Shift+O` to move between
  them
- Clicking a project or session reuses its existing tab rather than opening a second one,
  including a session reached with `/resume` inside a tab
- Closing a tab asks only when something is still running in it, and names it
- Windows notification when a background session finishes while ATC is not focused
- Ask either agent outside any project, in a shared scratch directory
- Search across scrollback with match counts
- Themes for the whole app: ATC Dark, Nord, Rosé Pine, Catppuccin Mocha and Latte, plus
  your own
- Whole-application zoom, persisted
- Sessions with no recorded working directory are shown but not launchable

**Usage** (`Ctrl+Shift+U`)
- Claude and Codex plan limits, refreshed while the page is open
- Local tokens and API-price estimates by provider, project, model and session, over any
  date range, with CSV export
- A spend chart that splits by model or project, shows a running total, and goes hourly
  for a single day; step day by day or click a bar
- The focused tab's session on its own: cost, tokens by model and cache share

**Configuration**
- Settings page in the app (`Ctrl+,`), and `settings.json` applied live; edits take
  effect without a restart
- A list of every shortcut (`Ctrl+Shift+?`)

## Keyboard shortcuts

Application shortcuts use `Ctrl+Shift`, which neither PowerShell, Claude Code nor Codex
binds. They are intercepted before the terminal sees them, so they never reach the shell.
Everything else, including `Ctrl+C`, `Ctrl+R`, `Tab` and `Shift+Tab`, is passed through
untouched.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New tab |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+R` | Rename this tab |
| `Ctrl+Shift+\` | Split into two panes, or back to one |
| `Ctrl+Shift+O` | Focus the other pane |
| `Ctrl+Shift+L` | Choose Claude or Codex in this tab's project |
| `Ctrl+Shift+N` | Open a terminal in this tab's project |
| `Ctrl+Shift+A` | Choose an agent in the shared scratch directory |
| `Ctrl+Shift+B` | Show or hide the sidebar |
| `Ctrl+Shift+P` | Filter projects and sessions |
| `Ctrl+Shift+K` | Switch the sidebar between sessions and tasks |
| `Ctrl+Shift+E` | Show or hide the task panel |
| `Ctrl+Shift+F` | Find in terminal |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+Shift+U` | Usage and spend |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+?` | Shortcut list |
| `Ctrl+Shift+D` | PTY statistics overlay |
| `Ctrl+Shift+I` | Developer tools (debug builds only) |

In the find bar: `Enter` next match, `Shift+Enter` previous, `Escape` close. Escape also
closes the Usage, Settings and Shortcuts pages. In a Codex tab, `Shift+Enter` and `Ctrl+J`
insert a newline.

## Codex

ATC discovers local Codex CLI, desktop and editor conversations, including sessions
started outside ATC. The sidebar mixes both providers by recency. Archived conversations
and child agents are hidden. Sessions without a recorded working directory remain visible
but cannot be resumed.

Right-click a project for **Open in Claude** or **Open in Codex**. Generic agent shortcuts
ask which provider to use: Tab and Enter choose, Escape cancels. The `+` button,
`Ctrl+Shift+T` and project shell buttons open plain shells.

Configure Codex in Settings or add this block to `settings.json`:

```json
"codex": {
  "command": "codex",
  "resumeArgs": ["resume", "{session}"],
  "homeDir": null
}
```

`command` is an executable name or path, not a shell expression. Arguments are separate
values, and ATC quotes them for PowerShell. The Codex home resolves from `codex.homeDir`,
then `CODEX_HOME`, then `%USERPROFILE%\.codex`; discovery, launches, copied resume
commands and limit requests all use it. When ATC runs inside a Windows job that forbids
breakaway (for example, launched from an IDE terminal), it starts Codex with `--no-daemon`,
since Codex's background server cannot start there.

Codex plan limits come from the documented [`account/rateLimits/read` app-server API](https://developers.openai.com/codex/app-server).
ATC starts `codex app-server` on demand, stops it after each request, and refreshes every
5 minutes while the Usage page is open. A customised Codex command that cannot be found
shows an error there rather than hiding the section.

This integration targets native Windows. It does not discover WSL or remote Codex
histories, or convert conversations between providers.

## Settings

`%APPDATA%\Agent Terminal Control\settings.json` — that is
`C:\Users\<you>\AppData\Roaming\Agent Terminal Control\settings.json` — created on first
run. The Settings page edits it, and its **Open settings.json** button opens the file in your editor.
Every field is optional; missing ones take their default.

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
    "theme": "ATC Dark",
    "groupSubfolders": false,           // sessions from a subfolder under the project containing it
    "groupByBranch": false,             // sessions under the branch they ran on
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

Beside it:

- **`tasks.json`** holds tasks. It is written by the app, but hand edits apply live. A file
  that does not parse is copied to `tasks.json.bad` before anything overwrites it.
- **`themes/`** takes extra themes as JSON files, in the shape Windows Terminal and VS Code
  terminal themes use (16 ANSI colours plus foreground, background, cursor and selection).
  A file named like a built-in theme replaces it.
- **`pricing.json`** adds or corrects model prices without waiting for a release. Its
  entries win over the built-in table, and it is read at startup:

  ```jsonc
  {
    "claude": [{ "match": "opus-6", "input": 5.0, "output": 25.0 }],   // USD per 1M tokens, substring match
    "codex": [{ "model": "gpt-7", "input": 2.0, "cached": 0.2, "cacheWrite": 2.5, "output": 10.0 }]
  }
  ```

Local token totals include linked child-agent usage. Cached input and reasoning are
subsets, not extra tokens. Costs are baseline API-price equivalents, not subscription
charges, and exclude tier, regional, long-context and tool surcharges. Unknown models stay
unpriced, and totals containing them are marked partial.

## Not included

- Command palette
- More than two panes, or top/bottom splits
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
lossy. More in [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

```
npm run test     # cargo test + vitest
npm run lint     # cargo fmt, clippy, svelte-check
npm run play     # run against fixtures, leaving real data alone
npm run test:e2e # build the app and drive it through WebDriver
```

CI runs `test` and `lint` on every pull request. Releases are built by
`.github/workflows/release.yml` from a `v*` tag, which leaves a draft release to publish.

`npm run test:e2e` needs `cargo install tauri-driver --locked` once; it downloads the
msedgedriver matching your WebView2 by itself, builds into `src-tauri/target-e2e`, and runs
against a throwaway copy of the fixtures with the agent commands replaced by an echo. It
runs locally only for now: WebView2 does not start under msedgedriver on GitHub's Windows
runners.

`scripts/` contains helpers for regenerating the icon and fixtures, capturing the window,
and sending real keystrokes to the running app.

### Isolated playground

For testing with your existing logins, histories and theme, use `npm run tauri dev`.
The playground is for synthetic discovery and UI tests: fixture IDs are not resumable CLI
conversations, and its CLI homes start signed out. Playground tabs use separate saved
state from normal development tabs.

`npm run play` copies synthetic Claude and Codex histories into `playground/config`. It
creates sample project directories, points both discovery roots there, and sets
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` for launched CLIs. It does not load personal
histories or copy credentials. Fixtures cover current and older metadata, renames,
desktop and editor sessions, missing working directories, child agents, and malformed or
partial records.

Codex pricing sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) and [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex). The checked rates also apply to dated snapshots; unknown model variants are never matched by a broad prefix.
