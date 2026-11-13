<p align="center"><img src="assets/atc-logo.png" width="128" alt="ATC icon: three white bars on a blue rounded square, a runway threshold"></p>

<h1 align="center">ATC</h1>

<p align="center">Agent Terminal Control<br>
A Windows terminal for Claude Code and Codex sessions.</p>

<p align="center"><b>Download v0.7.3:</b>
<a href="https://github.com/arghya2801/agent-terminal-control/releases/download/v0.7.3/ATC_0.7.3_x64_en-US.msi">MSI installer</a> (recommended) |
<a href="https://github.com/arghya2801/agent-terminal-control/releases/download/v0.7.3/ATC_0.7.3_x64-setup.exe">Setup exe</a> |
<a href="https://github.com/arghya2801/agent-terminal-control/releases/latest/download/atc.exe">Portable atc.exe</a><br>
<a href="https://github.com/arghya2801/agent-terminal-control/releases">Release notes and older versions</a></p>

A Windows terminal with one project tree for Claude Code and Codex sessions.
Clicking a project opens a shell there; clicking a session resumes that conversation.
The Open view lists the agents waiting on you first. From the sidebar you can queue
their next message, start new tasks and broadcast a line, without leaving the tab you
are in. A Usage page shows plan limits and what the work would have cost at API prices.

Claude and Codex tabs are a chat by default. Claude runs through the Claude Agent SDK and
Codex through its app-server, so they use the same CLIs with their own logins, models,
permissions, hooks, skills and session files. Ctrl+` or Ctrl+Shift+M moves a tab between
the chat and the CLI's own TUI on the same session. Settings > General > "Agent tabs
open as" picks which one new tabs use. Shell tabs are PowerShell in ConPTY.

## Why

Resuming a Claude Code session means remembering which directory it belongs to, then
stepping through `claude --resume`'s picker to find it. ATC reads
`~/.claude/projects` (and Codex's history) directly and lists every session under the
project it belongs to, so resuming is one click.

Shell tabs, and agents opened in a terminal, are xterm.js over a Windows ConPTY, the
same pseudo console Windows Terminal uses. Claude Code's and Codex's TUIs, PSReadLine,
colours and Ctrl+C work as they do there.

## Requirements

- Windows 10 1809 or later (ConPTY)
- WebView2 runtime (preinstalled on Windows 11)
- Windows PowerShell or PowerShell 7. By default ATC picks Windows PowerShell 5.1, which
  starts faster; the Shell setting picks PowerShell 7 instead
- Claude Code or the Codex CLI for the corresponding agent features. Either can be
  absent without disabling shells or the other provider.
- Node.js 18 or later on `PATH` for agent tabs, which run in a small Node process.
  Without it, sessions still open in a terminal.

## Install

Three downloads on the Releases page. Pick one.

| File | What it is |
|---|---|
| `ATC_<version>_x64_en-US.msi` | [Recommended] MSI installer. Installs for all users, needs admin. Also works for deploying through Group Policy or Intune. |
| `ATC_<version>_x64-setup.exe` | NSIS installer. Per-user, no admin prompt. Closes every running `atc.exe` before installing, portable copies included. |
| `atc.exe` | The bare executable. No installer, no Start menu entry, no uninstaller. Put it anywhere and run it. |

All three are the same application. The installers place that executable, add a Start
menu entry and register an uninstaller. They also install Windows Terminal's ConPTY
(`conpty.dll` and `OpenConsole.exe`, MIT) next to it, which passes colour queries through
to the terminal, so Codex's prompt bar matches the theme. The bare `atc.exe` uses the
ConPTY built into Windows unless those two files sit beside it.

### Updating

**Check for updates** in the ⋯ menu or the command palette, or the "is out" note at the
bottom of the sidebar, downloads the same kind of file you installed, closes ATC and runs
it. Open terminals and agents end. To update by hand, download the new release and run
the same kind of file you installed:

- **MSI.** Run the new `.msi`. It replaces the installed version in place. Close ATC
  first, or Windows asks to close it or restart.
- **Setup exe.** Run the new `setup.exe`. It also upgrades in place, and closes any
  running ATC itself.
- **`atc.exe`.** Replace the file.

Stick to one installer type. The MSI installs per machine and the setup exe per user,
so switching between them leaves two separate installs. Settings and notes are kept in
every case. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

The binaries are unsigned, so SmartScreen shows "Windows protected your PC" on first
run. Click **More info**, then **Run anyway**.

Settings, notes and cache live in `%APPDATA%\Agent Terminal Control\`. Uninstalling does
not remove them; delete that folder by hand if you want them gone.

### From source

```
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
npm ci
npm run desktop:dev      # Go reload + Vite HMR
npm run desktop:build    # portable executable
npm run desktop:package  # executable + MSI + NSIS installers
```

Requires Go 1.26 or later, Node 24, and WebView2. Packaging also requires NSIS and
WiX Toolset 3.x. Output lands in `build/bin/`.

The desktop host moved from Rust/Tauri to Go/Wails in 0.4.0 and kept the Svelte UI.
[docs/WAILS-MIGRATION.md](docs/WAILS-MIGRATION.md) has the build times, memory and test
results from that move.

## Capabilities

**Agent tabs**
- Replies stream in as they are written, as formatted text; thinking folds to one line
- Each tool call is one line with its input, a timer while it runs, the tail of its live
  output, and its result. Click it for the whole call, output or diff
- Permission prompts, questions and plan approvals are cards: Allow, Always allow or
  Deny with a reason; pick answers; approve the plan or say what to change
- `/` lists Claude's commands and skills, `$` lists Codex's skills, with descriptions.
  `@` picks a project file
- The footer picks the model, its effort and Claude's permission mode, and shows how long
  the turn has run. Each turn ends with its duration and cost
- Enter sends, Shift+Enter adds a line, Esc or Stop interrupts. A message sent while the
  agent works waits above the box and goes when the turn ends; Ctrl+X Ctrl+S or Send now
  sends it at once
- `/btw` asks Claude a side question without stopping it. The answer stays out of the
  conversation
- Paste or drop images into the message box. Rewind from one of your messages takes the
  conversation back to before it, and in Claude tabs the files too
- Claude's task list, and the shell commands and subagents running in the background,
  show above the message box
- Alt+Up and Alt+Down jump between the messages you sent
- The account chip runs a Claude tab as another account; see [Claude accounts](#claude-accounts)
- Ctrl+` or Ctrl+Shift+M (or the terminal button) closes the chat and resumes the session
  in `claude` or `codex`. In a terminal tab, the same keys or the chat button in the
  header come back

**Sidebar: sessions**
- Projects derived from Claude and Codex transcripts, resolved to their real paths, with
  a provider icon on each session
- Sessions listed newest first, labelled by the name the agent gives the session, falling
  back to its title, the first message, then the session id
- Filter: the search icon in the sidebar header, or start typing on a row. Matches
  project name, path, session name and branch. With three or more characters, an "In
  transcripts" section lists sessions whose prompts or replies mention it
- Space on a session previews its last prompts and replies without resuming it
- Git branch shown per session; optionally group sessions by branch, or group subfolders
  under the project containing them
- Sessions appear as they are created, without a restart
- Pinned projects sort first
- A dot on every session with an open tab: pulsing while the agent works, green when it
  is waiting for you, blue when it finished in a background tab, and a blue diamond when
  it asks a question or for permission
- Right-click a project: open Claude (or Claude as another account), Codex or a shell,
  rename, open in Explorer, copy path, pin or unpin, archive old sessions
- Right-click a session: preview, rename, rename with Haiku or Luna, archive, copy session
  id, copy resume command, open in Explorer
- Full keyboard use: Tab (or Down from the filter) enters the list, arrows move and
  expand, Enter opens, `Shift+F10` or the Menu key opens the context menu, Esc returns to
  the terminal
- Drag the sidebar's edge to resize it; double-click to reset

**Sidebar: open** (`Ctrl+Shift+K` switches views)
- Every open tab, under Waiting on you, Working, Shells and Done. Agents asking a question
  or for permission come first, then the one that stopped most recently. Each row has a
  dot for its state, the tab's name, the project, how long it has been in that state,
  how full its context window is, and 5 minutes of output unless it is waiting
- Hover a row for Done, which moves a waiting agent to Done until it works again, and
  Queue, which types your next message in when the agent stops
- A task box at the top: type a task and press Enter to start it in the background. The
  icon at its left switches between Claude and Codex; the project line under it picks
  where it runs, by default the focused tab's project
- Click a row to switch to it, middle-click to close. Ctrl+click rows to pick them, then
  type one line into all of them from the bar at the bottom
- `Ctrl+Shift+J` goes to the agent that has waited longest. `Ctrl+Shift+G` shows every
  tab at once; click one to go to it
- A notes pad under the list, stored as `notes.md`: raw Markdown while you type, rendered
  when you click away, with checkboxes you can tick in place. Click its header to
  collapse it; drag its top edge to resize

**Terminal**
- Tabs, each a separate PowerShell process, reopened on the next launch. By default there is
  no tab bar: the sidebar's Open view switches tabs, and the header names the one shown,
  its project, branch and state. Double-click the name to rename it. Settings > Appearance
  > Tab bar brings back tabs across the top, which drag to reorder
- Split panes: two terminals side by side (`Ctrl+Shift+\`), `Ctrl+Shift+O` to move between
  them
- Clicking a project or session reuses its existing tab rather than opening a second one,
  including a session reached with `/resume` inside a tab
- Closing a tab asks only when something is still running in it, and names it
- A Windows notification when a background agent finishes or asks something while ATC is
  not focused, and a note in the corner while it is
- Ask either agent outside any project, in a shared scratch directory, or chat with one
  that cannot change anything: Claude with no tools or MCP servers, Codex in a read-only
  sandbox. Both start from the `+` in the sidebar's Scratch view, and are listed there
- Search across scrollback with match counts
- 45 themes for the whole app, among them ATC Dark, One Dark, Dracula, GitHub, Tokyo Night,
  Catppuccin, Rosé Pine, Gruvbox and Solarized in dark and light, plus your own
- Whole-application zoom, persisted
- Sessions with no recorded working directory are shown but not launchable

**Usage** (`Ctrl+Shift+U`)
- The usage chip in the header shows Claude's 5-hour session limit and when it resets.
  Hover it for every limit and today's spend; click it for this page
- Claude and Codex plan limits, refreshed while the page is open, each with a line of how
  it filled and when it runs out at the recent pace
- Local tokens and API-price estimates by provider, project, model and session, over any
  date range, with CSV export
- A spend chart that splits by model, project, provider or token type, shows a running
  total or a 7-day average, and goes hourly for a single day; step day by day or click a bar
- A weekday-by-hour heatmap of when the usage happened
- Share mode: split bars at 100%, to compare the mix between days
- A year calendar of daily usage with active days and streaks
- 5-hour blocks: usage in windows like Claude's session limit, each with active hours,
  tokens and cost
- Cache hit rate: the daily share of input tokens read from the prompt cache
- The focused tab's session on its own: cost, tokens by model and cache share

**Configuration**
- Settings page in the app (`Ctrl+,`), one section at a time, with a search across all of
  them, and `settings.json` applied live; edits take effect without a restart. The Advanced section has the rarer ones: shell, profile,
  GPU drawing, close confirmation and refresh intervals
- A list of every shortcut (`Ctrl+Shift+?`)

## Keyboard shortcuts

Application shortcuts use `Ctrl+Shift`, which neither PowerShell, Claude Code nor Codex
binds. They are intercepted before the terminal sees them, so they never reach the shell.
Everything else, including `Ctrl+C`, `Ctrl+R`, `Tab` and `Shift+Tab`, is passed through
untouched. Settings > Keyboard changes any of them: Change records a new chord, Clear
removes it, Reset brings back the default, and Reset all undoes every change.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New tab |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+R` | Rename this tab |
| `Ctrl+Shift+\` | Split into two panes, or back to one |
| `Ctrl+Shift+O` | Focus the other pane |
| `Ctrl+Shift+J` | Go to the agent that has waited longest |
| `Ctrl+Shift+G` | Show every tab at once, or back to one |
| `` Ctrl+` `` / `Ctrl+Shift+M` | Switch an agent tab between chat and terminal |
| `Ctrl+Shift+L` | Choose Claude or Codex in this tab's project |
| `Ctrl+Shift+N` | Open a terminal in this tab's project |
| `Ctrl+Shift+A` | Choose an agent in the shared scratch directory |
| `Ctrl+Shift+B` | Show or hide the sidebar |
| `Ctrl+Shift+P` | Command palette: actions, tabs, projects and sessions |
| `Ctrl+Shift+Y` | Change theme: arrows preview each one, Enter keeps it, Esc puts the old one back |
| `Ctrl+Shift+K` | Switch the sidebar between sessions, open tabs and scratch |
| `Ctrl+Shift+F` | Find in the terminal or chat |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+Shift+U` | Usage and spend |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+?` | Shortcut list |
| `Ctrl+Shift+D` | PTY statistics overlay |
| `Ctrl+Shift+F12` | Developer tools (debug builds only) |

In the find bar: `Enter` next match, `Shift+Enter` previous, `Escape` close. Escape also
closes the Usage, Settings and Shortcuts pages. In Claude Code and Codex, `Shift+Enter` and
`Ctrl+J` insert a newline.

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
  "args": [],
  "chatArgs": ["--sandbox", "read-only"],
  "resumeArgs": ["resume", "{session}"],
  "homeDir": null,
  "defaultEffort": "medium"
}
```

`command` is an executable name or path, not a shell expression. Arguments are separate
values, and ATC quotes them for PowerShell. The Codex home resolves from `codex.homeDir`,
then `CODEX_HOME`, then `%USERPROFILE%\.codex`; discovery, launches, copied resume
commands and limit requests all use it. ATC starts Codex with `--no-daemon`, since
Codex's background server often fails to start under it.

Codex plan limits come from the documented [`account/rateLimits/read` app-server API](https://developers.openai.com/codex/app-server).
ATC starts `codex app-server` on demand, stops it after each request, and refreshes every
5 minutes while the Usage page is open. A customised Codex command that cannot be found
shows an error there rather than hiding the section.

This integration targets native Windows. It does not discover WSL or remote Codex
histories, or convert conversations between providers.

## Claude accounts

Step by step: [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

Settings > Claude accounts holds more than one Claude login. Add a **subscription**
(**Get a token** runs `claude setup-token` in a tab; sign in there and the token comes
back to the form) or an **API key** (checked before it is saved). Each account can be
shown, copied, edited or removed there, and one is the default for new Claude tabs.

A tab runs as one account: pick it from the chat's account chip, or **Open in Claude as**
in a project's right-click menu. Switching a running chat restarts Claude on the same
conversation. A resumed session uses the account it last ran as. The tab header names the
account.

ATC passes the account to Claude as `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, so
history, settings, skills and `CLAUDE.md` in `~/.claude` stay shared and are never edited.
**Claude login** means whoever is signed in there. Secrets are kept in `accounts.dat` in
ATC's config folder, encrypted with Windows DPAPI for your Windows user. The limits meter
follows the default account; an API key account has no plan limits.

## Settings

Settings live in `%APPDATA%\Agent Terminal Control\settings.json`, which is
`C:\Users\<you>\AppData\Roaming\Agent Terminal Control\settings.json`, created on first
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
    "animations": "system",             // "on" or "off"; "system" follows Windows' animation effects
    "animationSpeed": 1.0,              // 2 is twice as fast, 0.5 half as fast
    "groupSubfolders": false,           // sessions from a subfolder under the project containing it
    "groupByBranch": false,             // sessions under the branch they ran on
    "notifications": true,              // notify when a background session needs you
    "restoreTabs": true,                // reopen last session's tabs on launch
    "sidebarView": "open",              // "sessions", "open" or "scratch"
    "showTabBar": false,                // tabs across the top as well as in the sidebar
    "usageResetTime": true,             // when the 5-hour limit resets, beside the usage chip
    "outputGraph": true,                // Open view output graph
    "agentView": "chat",                // agent tabs open as "chat" or "terminal"
    "confirmSwitch": true,              // warn before moving a tab between chat and terminal
    "renameModel": "haiku",             // "haiku" or "luna", for Rename with Haiku or Luna
    "chatFontSize": 13,                 // agent chat text, 9 to 24
    "chatFontFamily": "",               // "" = the app's font
    "accent": "",                       // a hex colour for the chrome's accent; "" = the theme's
    "backdrop": "mica",                 // "mica", "acrylic" (both from the next launch) or "solid"
    "stateShapes": false,               // a shape per tab state as well as a colour
    "notifyFinished": true,             // notify when an agent finishes
    "notifyAsking": true,               // notify when an agent asks a question or for permission
    "toastCorner": "bottom-right",      // or "bottom-left", "top-right", "top-left"
    "blockedDetection": true,           // read terminal agents' screens for a question
    "checkUpdates": true,               // ask GitHub for a newer release on launch
    "rowProject": true,                 // Open view rows: the project,
    "rowState": true,                   // the state and how long,
    "rowContext": true,                 // and how full the context window is
    "keys": { "newTab": "Ctrl+Shift+Q" }, // shortcut overrides; "" removes one
    "taskAgent": "claude",              // what the task box starts with
    "taskProject": "",                  // "" = the focused tab's project
    "newTabIn": "home",                 // "project" opens Ctrl+Shift+T in the focused tab's project
    "confirmClose": true,               // ask before closing a tab with a program running
    "toasts": true,                     // in-app notes while ATC is focused
    "toastSeconds": 6,
    "limitsRefreshSec": 300,            // Claude plan limits, while ATC is showing
    "codexRefreshSec": 300              // Codex limits, at most this often while the usage peek or page is open
  },
  "terminal": {
    "fontFamily": "\"FiraCode Nerd Font Mono\", \"Cascadia Mono\", Consolas, monospace",
    "fontSize": 13,
    "scrollback": 10000,
    "cursorStyle": "bar",               // "block" or "underline"
    "cursorBlink": true,
    "lineHeight": 1.0,
    "shell": "auto",                    // Windows PowerShell first; or a pwsh.exe path, "pwsh" or "powershell"
    "loadProfile": true,                // false starts tabs with -NoProfile
    "gpuTabs": 4                        // tabs drawn with WebGL; 0 = software rendering
  },
  "claude": {
    "command": "claude",
    "args": [],                               // on every launch, e.g. ["--model", "opus"]
    "chatArgs": ["--tools=", "--strict-mcp-config"],  // added for chats
    "resumeArgs": ["--resume", "{session}"],  // {session} is the session id
    "scratchDir": null,                       // null = <config dir>\\scratch
    "atcLabel": true,                         // chat requests say "atc", not the SDK's "sdk-ts"
    "account": "",                            // default account id; "" = the ~/.claude login
    "defaultEffort": "medium"                 // low to max; "" leaves it to the CLI
  }
}
```

The `codex` block is under [Codex](#codex). Its `defaultEffort` runs from minimal to xhigh.

A malformed file is ignored rather than overwritten; the app keeps its current settings.

Beside it:

- **`notes.md`** holds the notes pad. Edits made in another editor apply live. On first run
  it is filled from `tasks.json`, if there is one; that file is left in place and no longer
  read.
- **`themes/`** takes extra themes as JSON files, in the shape Windows Terminal and VS Code
  terminal themes use (16 ANSI colours plus foreground, background, cursor and selection).
  A file named like a built-in theme replaces it.
- **`prices-latest.json`** is the price table, downloaded from the repository's `main`
  branch at launch. Delete it to fall back to the table built into the app.
- **`pricing.json`** adds or corrects model prices yourself. Its entries win over the
  price table:

  ```jsonc
  {
    "claude": [{ "match": "opus-6", "input": 5.0, "output": 25.0 }],   // USD per 1M tokens, substring match
    "codex": [{ "model": "gpt-7", "input": 2.0, "cached": 0.2, "cacheWrite": 2.5, "output": 10.0 }]
  }
  ```

- **`accounts.dat`**, **`usage-history.json`**, **`limits-history.jsonl`**, **`atc.log`**
  and **`sidecar.log`** are ATC's own: Claude account secrets, usage kept after Claude
  deletes old transcripts, plan-limit readings, and logs.

Local token totals include linked child-agent usage. Cached input and reasoning are
subsets, not extra tokens. Costs are baseline API-price equivalents, not subscription
charges, and exclude tier, regional, long-context and tool surcharges. Unknown models stay
unpriced, and totals containing them are marked partial.

Codex pricing sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) and [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex). The checked rates also apply to dated snapshots; a broad prefix never matches an unknown model variant.

## Not included

- More than two panes, or top/bottom splits
- Shells other than PowerShell
- Anything other than Windows

## How it works

Go owns the PTY. A reader goroutine feeds a bounded queue; a second goroutine
coalesces output on an 8 ms tick and sends it through Wails events. The frontend
acknowledges bytes once xterm has parsed them, which slows the shell down instead of
dropping output.

Agent chat tabs run in one Node process, the sidecar, which drives Claude through the
Agent SDK and Codex through `codex app-server`.

Session metadata comes from the head of each transcript, which holds the label, working
directory and branch, and its last 64 KiB, which holds renames. ATC caches both against
file size and modification time. It reads the working directory from inside the file and
never decodes it from the directory name, which is lossy.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): the code map, how each part works, and the gotchas
  that cost time once
- [CHANGELOG.md](CHANGELOG.md): what changed in each release
- [docs/ACCOUNTS.md](docs/ACCOUNTS.md): running Claude tabs as more than one account
- [docs/WAILS-MIGRATION.md](docs/WAILS-MIGRATION.md): measurements from the move from
  Rust/Tauri to Go/Wails in 0.4.0
- [docs/CODEX-VALIDATION.md](docs/CODEX-VALIDATION.md): the check of the Codex
  integration in September 2026

## Development

```
npm run build    # frontend assets, required before Go tests on a fresh checkout
npm test         # Vitest + Go tests, including native ConPTY integration
npm run lint     # go vet + svelte-check
go test -race ./... # requires a C compiler compatible with Go
npm run play     # run against fixtures, leaving real data alone
npm run test:e2e # build the app and drive it through WebDriver
```

CI runs `test` and `lint` on every pull request. Releases are built by
`.github/workflows/release.yml` from a `v*` tag, which leaves a draft release to publish.

`npm run test:e2e` downloads the msedgedriver matching WebView2, builds a test-only
executable in `build/e2e`, and drives the real desktop application. It uses throwaway
fixtures and echo commands for the agents. It requires an interactive Windows desktop.
The test loader enables a loopback debugging port in a local copy of its dependency;
production binaries and the Go module cache are untouched.

`scripts/` contains helpers for regenerating the icon and fixtures, capturing the window,
and sending real keystrokes to the running app. ARCHITECTURE.md describes driving the UI
without taking focus, and the gotchas that cost time once.

### Isolated playground

For testing with your existing logins, histories and theme, use `npm run desktop:dev`.
The playground is for synthetic discovery and UI tests: fixture IDs are not resumable CLI
conversations, and its CLI homes start signed out. Playground tabs use separate saved
state from normal development tabs.

`npm run play` copies synthetic Claude and Codex histories into `playground/config`. It
creates sample project directories, points both discovery roots there, and sets
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` for launched CLIs. It does not load personal
histories or copy credentials. Fixtures cover current and older metadata, renames,
desktop and editor sessions, missing working directories, child agents, and malformed or
partial records.
