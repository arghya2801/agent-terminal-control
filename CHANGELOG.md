# Changelog

Notable changes to ATC. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Add a line under **Unreleased** in each PR. When cutting a release, rename that section to the version and paste it into the GitHub release body.

## [Unreleased]

## [0.7.4] - 2026-11-13

### Added
- Palenight, SynthWave '84 and VS Code Light Modern themes (#269).

### Fixed
- Clicking a Windows notification brings ATC forward on the tab it is about.
- Long commands and paths in a hover box wrap inside it instead of running past its edge (#267).
- Shortcut hints in the header and the sidebar show a changed shortcut straight away.

## [0.7.3] - 2026-11-13

### Added
- Claude and Codex in a terminal tab show when they ask a question or for permission, not only when they finish. The tab gets a diamond instead of a dot and reads "asking" in the Open view, where it sorts first under Waiting on you, and its notification says it is asking. ATC reads this from the bottom of the screen, with rules adapted from Herdr's.
- Check for updates, in the ⋯ menu and the command palette. Install downloads the MSI, setup.exe or portable `atc.exe`, whichever this copy came from, closes ATC and runs it. The "is out" note in the sidebar opens the same prompt.
- 40 more built-in themes, among them One Dark, Dracula, GitHub, Tokyo Night, Gruvbox, Solarized, Monokai, Kanagawa, Everforest, Ayu and Campbell, in dark and light (#269).
- Change theme (Ctrl+Shift+Y, or the ⋯ menu and the command palette) lists every theme under Dark and Light. Arrow keys apply each one to the whole app as you go, Enter keeps it, and Esc puts the old one back.
- Settings > Keyboard: change any shortcut by pressing the new one, clear it, reset it, or reset them all. A chord another action already has is flagged.
- Settings > Appearance: an accent colour over the theme's, a Mica, Acrylic or Solid backdrop, shapes for tab states, and a text size and font for agent chats.
- Settings > General > Notify when: turn notifications off for agents finishing or for agents asking, separately. In-app notes can sit in any corner.
- Settings > Sidebar > Open view rows show: hide the project, the state and time, or the context use.
- Settings > Advanced: turn off reading terminal agents' screens for questions, or the update check on launch.

### Changed
- Settings shows one section at a time, picked from the list at its left, instead of one long page. Search still looks through every section. Settings reopens on the section you last had open.

## [0.7.2-beta] - 2026-11-11

### Added
- Force send: Ctrl+X Ctrl+S in an agent tab, or Send now beside a queued message, sends it at once. Claude stops what it is doing and takes it; a Codex turn stops and the message sends as it ends.
- `/btw` in a Claude tab asks a side question, as in Claude Code: Claude answers from the conversation so far, even mid-turn, without stopping. The answer shows above the message box and stays out of the conversation.
- Settings > Agents > Default effort, Medium unless changed, for new and resumed Claude and Codex tabs, in the chat and in a terminal.
- Settings > About shows the version, with a link to the releases.
- Claude accounts: add subscription tokens and API keys in Settings, see and edit them there, pick a default, and run each Claude tab as any of them. Nothing in `~/.claude` changes; secrets are kept encrypted in ATC's config folder (#252).
- Agent tabs list the shell commands and subagents running in the background above the message box, with the last tool each ran, a progress summary on hover, and a Stop button. Claude only (#259).
- Find (Ctrl+Shift+F) searches the text of agent chats too. Folded tool groups are not searched (#257).
- Alt+Up and Alt+Down in an agent tab jump to the previous or next message you sent (#251).

### Changed
- Waiting on you lists the agent that stopped most recently first. Ctrl+Shift+J still jumps to the one that has waited longest.
- New chats no longer start at the effort picked last; they start at the default effort. The effort picker's Default is now CLI default, which leaves the effort to the CLI's own settings.

### Fixed
- A skill's instructions no longer show in an agent tab as a message from you (#256).
- Rename with Haiku or Luna shows "Naming…" on the session's row while it runs, and another session can be renamed meanwhile (#255).

## [0.7.1] - 2026-11-10

### Changed
- The header has a button to switch an agent tab between chat and terminal, also when the tab bar is on (#247).
- Switching an agent tab between chat and terminal always warns while the agent is working, even with the warning turned off, since the turn stops (#246).
- Code blocks in agent tabs are syntax highlighted, and so are the commands Claude runs and the code in its edits (#244).
- The message box placeholder is fainter (#245).
- Open view rows drop the screen preview. The session name has the first line to itself; the project, state, time and context use sit on the second. The Screen peek setting is gone (#242).
- Typing `/` or `$` in an agent tab says when commands and skills are still loading, or when nothing matches. `/` opens the menu anywhere in a message, as in Claude's CLI, not only at the start (#243).
- `/` lists commands and skills at once, from the last list seen for that project (or provider), while the session's CLI starts.
- New chats start on the model and effort you picked last for that provider.
- Switching an agent tab between chat and terminal logs how long each step took to `atc.log` in the config folder.
- Agent tabs opened in a terminal skip the PowerShell profile, so they start faster.
- The Shell setting lists the PowerShells installed on the machine. "auto" now picks Windows PowerShell 5.1 when it is there, since it starts faster than PowerShell 7.

### Fixed
- Agent tabs scroll to the bottom when you send a message, and keep following while the agent works. Scrolling up stops it; scrolling back to the bottom resumes it (#248).
- A tab marked done stays done through a recap and across restarts, until you send it something (#241).
- Switching a terminal agent tab to chat resumes its session when ATC has matched it but not yet bound it, instead of starting a new one (#247).

## [0.7.0] - 2026-11-06

### Changed
- Claude and Codex tabs are a chat instead of a terminal. Claude runs through the Claude Agent SDK and Codex through its app-server: the same CLIs, logins, settings, hooks, skills, MCP servers and session files. Replies stream in; each tool call is one line with a timer, its live output and its result; permission prompts, questions and plan approvals are cards with buttons; `/` (Claude) and `$` (Codex) list commands and skills with their descriptions; the footer picks the model and Claude's permission mode and shows the turn's running time, and each turn ends with its duration and cost. "Open in terminal" resumes the session in the CLI's own TUI. Agent tabs need Node.js 18 or later on PATH.
- In agent tabs, a run of tool calls reads as one line ("Read 3 files and ran 2 commands") that opens to the calls; the turn being worked on stays open. Each turn hangs off a rail with a light per call. The working line says what the agent is doing ("Running npm test", or its current thought), paths show relative to the project, Up and Down recall earlier prompts, and replies and code blocks have a Copy button.
- An effort picker beside the model in agent tabs, for models that take one: Claude changes it mid-session, Codex from the next message. A new agent tab's model picker lists Claude's and Codex's models together; picking the other provider's moves the tab to it, until the first message is sent.
- Codex tabs take `/compact`, `/review`, `/undo`, `/new` and `/rename`, and the mode chip picks Read only, Workspace or Full access for the next turns. When Codex's own reviewer approves something (`approvals_reviewer = "auto_review"`), the chat says what it decided.
- Paste or drop images into an agent tab's message box, for Claude and Codex: PNG, JPEG, GIF or WebP, up to 5 MB each. They show above the prompt they went with.
- Rewind an agent tab: hover one of your messages and choose Rewind. The conversation goes back to before it and the message returns to the box. In Claude tabs, files Claude changed since then go back too, as Esc Esc does in the CLI. Codex can't undo its edits, so its files stay as they are.
- Type `@` in an agent tab's message box to pick a project file. The list is git's (ignored files left out), or the folder's own outside a repo.
- Claude's task list shows above the message box while any task is open, with each task's state ("2 of 5 tasks done"). Codex's plan shows there too, when Codex sends one.
- A new look for agent tabs. Your messages sit on the right. Each thing the agent did is one row with an icon and a plain verb ("Ran npm test", "Edited cli.js"), and a failed or declined call says why underneath. Permission and question cards have clearer buttons, and number keys pick an answer. The task list folds to one line while a card waits. Tables, code blocks and the `/` menu (with matches highlighted) are easier to read. An image button sits in the message box, and a stopped session offers Resume. The pane header shows the model, cost and context; tokens and cache use moved into the cost's tooltip.
- Agent tabs use far less memory. A resumed Claude or Codex tab shows its conversation without starting the CLI, which starts when you type or send (a Claude CLI holds about 370 MB). Codex tabs read through one shared app-server instead of one each. A long reply takes less CPU while it streams. The notes editor loads the first time the notes pane opens, and the header stops re-reading costs while its agent is idle.

- Choose chat or terminal for agent tabs: Settings > General > "Agent tabs open as" picks Chat (the default) or Terminal, the CLI's own screen. Ctrl+` or Ctrl+Shift+M moves any agent tab between the two on the same session, and a terminal agent tab has a chat button in its header. Restored tabs come back the way you left them.
- Switching an agent tab between chat and terminal warns first: what moves, and whether a turn in progress stops. "Don't show this again" turns the warning off; Settings > General > Confirm switch turns it back on.
- Search settings: a box at the top of Settings filters it as you type. It matches loosely ("fnt sz" finds Font size) and also searches hints and section names; Esc clears it.
- The usage page's controls are one toolbar: provider, the dates with day steps, and the range presets, with Rescan and Export CSV beside the heading. Each set of options is one segmented control, and costs no longer say "(partial)"; the page already notes that unknown prices are left out.
- Usage over time as a line chart, now the default; Bars beside it switches back. Split by model, project or provider, it draws a line per series; hovering shows a crosshair and each line's value.
- Rename with Haiku or Luna renames the session straight away, rather than filling the rename box, and the open tab takes the name too. In the Open view, right-click a tab to rename its session or every open session this way.
- The Open view keeps each tab's project name in sight: a long title is cut short before the project is.
- Agent chat polish. A stopped turn says "Stopped after", and a group with a stopped call is marked Stopped. Calls that took 5 seconds or more keep their time once finished. The working line names the running call. A "Jump to latest" button shows when you scroll up. Tool rows show their chevron at rest. Long question cards scroll inside the card, with their buttons in view. The queued message shows up to three lines, its full text on hover, and how many images go with it. While a turn runs, the send button reads Queue, and the placeholder under a card says messages go after the turn.
- Accessibility in agent tabs. Screen readers hear when the agent starts, waits on you, finishes or stops. A permission or question card takes focus when it arrives, unless you are typing. Questions label their options and answer boxes. The `/` `$` `@` menu works as a combobox. Picking a model or mode returns focus to its chip. Faint text has more contrast.
- Agent chat, second pass. Your messages are a soft card instead of a grey pill. A turn's answer, the text after its last tool call, is brighter and set apart from the narration, and the turn's Copy copies the answer. While a call runs, the working line shows the turn clock instead of repeating the call. Long tool output keeps its end as well as its start, and a finished call says how many lines it printed. A short window keeps the conversation in view: the request card shrinks and scrolls. "Always allow" reads "Allow for session". While a turn runs, the box says Enter queues a message. The toolbar wraps in a narrow pane.
- Keyboard and screen readers in agent tabs: arrow keys move between a question's options, focus returns to the message box after you answer a card, and the task list announces each task's state. Light themes have readable faint text and button labels.

### Fixed
- Animations and Animation speed apply as soon as they change, not after a restart.
- In an agent tab, editing a recalled prompt and pressing Up or Down again moves the cursor instead of throwing the edit away.
- Copy in an agent tab says so when the clipboard write fails, instead of showing Copied.
- Ctrl+Shift+F no longer opens a find bar in a chat tab, where it found nothing.
- Moving an agent tab from chat to terminal waits for the chat's CLI to exit first, so the terminal never finds the session still held ("already has an active writer").
- A message sent to a session that has ended says so, instead of vanishing.
- Reloading the window while an agent tab opens no longer loses that tab's session to the old sidecar's shutdown. The sidecar's log is no longer held open after it starts.
- Long agent conversations open faster, a sent image is kept once instead of three times, and a transcript search you've typed past stops scanning.
- Exporting the usage CSV writes only where you chose in the save dialog; the page can no longer ask for a write anywhere else.
- Fewer "rate-limiting usage checks" errors: Claude's plan limits refresh every 5 minutes by default (was 90 seconds), and a hidden or minimised ATC window skips its checks and catches up when shown. Every ATC window and Claude Code share the account's limit on these checks. A saved setting keeps its value; change it in Settings > Advanced.
- In an agent tab, a group of tool calls no longer counts failed or declined calls as done ("Changed 2 files" when one edit failed). Copy on a code block reports a failure and no longer covers the code. An input method's Enter no longer picks from the `/` menu.
- Closing Settings saves only what was edited in it, so a change made elsewhere while it was open, such as an edit to settings.json, is kept.
- The git calls ATC makes on its own, such as reading an agent's changes when it stops, ignore a repository's `core.fsmonitor` setting, which could run a command the repository names.
- A confirmation dialog always goes away once answered. It moves itself to the top of the page, where closing it did not always find it.
- Claude chat tabs label their requests `atc`. Under the Agent SDK's own label, Anthropic's 5-hour meter has been reported charging about twice what the CLI pays for the same tokens, and a custom label at the CLI's rate (pingdotgg/t3code#24649). A Pro account measured in November showed no difference (#205), so this is a precaution. Weekly limits were never affected. Settings > Agents > Label requests "atc" turns it off.
- The 5-hour limit's graph no longer spills out of its card when the session has not started (#203).
- With the tab bar hidden, Ctrl+Tab goes through tabs in the Open view's order (#204).
- An approved plan in a Claude tab leaves plan mode, so the mode chip no longer stays on Plan.
- A resumed Codex conversation whose saved model Codex no longer lists moves to the default model, instead of failing its next turn.
- An agent tab waiting on a permission or question shows as waiting in the sidebar and header even while you are looking at it, instead of idle.

## [0.6.2] - 2026-10-24

### Added
- How fast each plan limit fills: on the usage page, each Claude and Codex limit gets a line of % used across its window, and an estimate of when it runs out at the recent pace ("At this pace it runs out Sat, 03:24", or "lasts until the reset"). ATC keeps 8 days of readings in `limits-history.jsonl` in its config folder, so the line starts from the first reading after this update.
- Preview a session before resuming it: press Space on a session row, or right-click it and choose Preview. Its last prompts and replies show beside the sidebar, with tool calls collapsed to their names. Enter resumes it, Esc closes.
- Search what was said: with three or more characters in the Sessions filter, an "In transcripts" section lists sessions whose prompts or replies mention it, with the matching line. Click one to resume it.
- Archive sessions: right-click a session and choose Archive to hide it from the sidebar without deleting anything. "Archive old sessions…" on a project archives everything older than a number of days, optionally only those under a cost. "Show archived sessions" at the bottom of the list brings them back.
- Rename with Haiku or Luna: right-click a session and a small model suggests a name from its opening prompts and latest reply. The suggestion opens in the rename box. Settings > Names picks Claude Haiku (the default) or Codex Luna; it runs through the installed CLI and leaves no session behind.
- Queue a message for a working agent: hover its row in the Open view and choose Queue, or right-click it. ATC types it in when the agent stops. The queued text shows under the row, where it can be edited or cancelled, and is dropped if the tab exits.
- What each agent has changed: the header shows files changed, insertions and deletions in the tab's folder, and the Open view row's tooltip lists them. It refreshes whenever the agent stops working, and only appears in git repositories.

### Fixed
- When Claude's usage endpoint answers 429, ATC backs off: it waits for `Retry-After`, or doubles its wait from 2 minutes up to 30, and sends no usage checks until then. The last numbers stay on screen with the retry time.

## [0.6.1] - 2026-10-24

### Fixed
- Claude Opus 5.5 is priced at its own rates ($4 / $20, cache reads $0.20) instead of Opus 5's. Haiku 5.5, which showed as unpriced, is priced too, and Fable 5.1 cache reads use its $0.25 rate.
- Usage history keeps sessions whose transcripts are gone. Claude Code deletes transcripts after 30 days, and their days used to vanish from the usage page. ATC now keeps every row it has seen in `usage-history.json` in its config folder.
- Show in Explorer only opens folders. Given a file path, it used to run the file.

### Added
- When a newer release is on GitHub, the sidebar footer says so ("0.7.0 is out") and links to its page. ATC checks once per launch and never downloads anything.
- Context window fill per agent tab: the header shows "42% context", and Open view rows show the percent next to their state. It turns amber at 80%.
- Mark a waiting agent done with the check on its row, or from its right-click menu. It moves to a Done section below Shells and comes back to Waiting on you the next time it works and stops.

### Changed
- Development: commands are typed Wails bindings instead of one string switch; the usage page is split into a component per view; vite 8, vitest 5, TypeScript 6. No change in behaviour.
- The Reply button is gone from the Open view.
- The usage chip puts its percent, meter and reset time on one line.
- The pane header reads as a path: project / branch / tab name, then its state. The branch shows on `main` too.
- The header's right side shows the session's model, cost, tokens and cache share, and the tab's 5-minute output graph. New and close moved next to the usage chip, so the name no longer looks like a tab.
- An idle agent you have already seen gets a hollow ring instead of a green dot. Colour now means it needs you or is working.

## [0.6.0] - 2026-10-22

### Changed
- The sidebar's Open view is an inbox: agents waiting on you come first, longest-waiting first, under Waiting on you, Working and Shells headings. Each row shows how long it has been in its state, the last line on its screen and a 5-minute output graph.
- The tab bar is gone. A header names the tab on screen with its project, branch and state; double-click the name to rename it. Tabs can no longer be dragged into order.
- New chats start in the scratch directory; the separate chats folder is no longer used. Chats started there before still show in the Scratch view.
- The sidebar filter sits behind a search icon in every view. Typing on a row starts a filter too.
- The task box is one field: the icon at its left switches between Claude and Codex, and the project line under it picks where the task runs.

### Added
- The usage chip shows when the 5-hour limit resets, in grey beside it. Settings > Appearance > Usage reset time hides it.
- A Tab bar setting, off by default, brings back tabs across the top. They can be dragged into order.
- Reply in place: a waiting agent's row shows its question and a Reply button that sends your answer without leaving the tab you are in.
- A task box at the top of the Open view starts Claude or Codex on a task in the background.
- Ctrl+click rows in the Open view to pick them, then send one line to all of them.
- Ctrl+Shift+J goes to the agent that has waited longest.
- Ctrl+Shift+G shows every tab at once, labelled by state. Click one to go to it.
- Rename in the Open view's row menu.
- The notes pad collapses to its header, like the Outline pane in VS Code's sidebar.
- Chat with Claude or Codex from the Scratch view's `+` or the command palette. A Claude chat has no tools or MCP servers; a Codex chat runs commands in a read-only sandbox. Restored tabs stay chats.
- Settings for launch arguments and chat arguments per agent, the Open view's screen peek and output graph, what the task box starts with, and the terminal cursor and line height.
- An Advanced settings section: PowerShell 7 or Windows PowerShell, loading the PowerShell profile, how many tabs are drawn with the GPU, where a new tab opens, confirming close, in-app notes and how long they stay, and how often plan limits refresh.

### Fixed
- The usage chip shows Claude's 5-hour session limit, not whichever limit is fullest. Hover it for the weekly limits.
- With the app zoomed, menus and tooltips open inside the window instead of off its edge, and dragging the sidebar edge or the notes divider keeps up with the pointer.
- A tooltip near the right edge of the window no longer touches the edge.
- Dragging the notes divider resizes the notes again.
- Pressing Enter to finish renaming a tab no longer also sends Enter to the terminal.

## [0.5.0] - 2026-10-21

### Changed
- One set of line icons replaces the mixed symbols in the sidebar, tab bar and find bar.
- The focused tab has an accent line on its top edge. While an agent works, a light sweeps along that edge. A dot that needs you rings twice when it lands.
- Menus, dialogs, pages and the find bar ease in, projects slide open, and the sidebar slides in and out like a drawer, carrying the terminal with it. The selected tab and sidebar view draw their accent line in, a context menu grows from the corner nearest the cursor, and usage bars and meters move to their new values. The new Animations setting controls this.
- Tab close buttons show on hover and on the focused tab only.
- Sidebar and settings headings use sentence case, and the sidebar footer leaves out zero counts.
- The UI uses Segoe UI Variable, the Windows 11 system font.
- Settings and keyboard shortcuts open as a popup over the dimmed app; Esc or a click outside closes them. Settings is one scrolling page with a section list for General, Appearance, Terminal, Sidebar, Agents and Names, with Claude and Codex side by side, and every change saves as you make it.
- The usage page holds space for Codex limits and this tab's session while they load, so nothing below jumps when they arrive.

### Added
- An Animations setting: Follow Windows (default), On or Off. With Windows' animation effects turned off, ATC stays still unless set to On.
- An Animation speed slider under Settings > Appearance, from half to three times as fast.
- A command palette on Ctrl+Shift+P: every action, open tab, project and session in one fuzzy-searched list. The sidebar filter box no longer has its own chord.
- A toast in the corner when a background tab finishes while ATC has focus. Click it to go to that tab.
- Tooltips appear after a short pause instead of a second, and show their shortcut as a key.
- Context menus have icons and, where one exists, the matching shortcut. Right-click a tab to rename it, split beside it or close it.
- The sidebar filter highlights what matched in project, session and tab names.
- A split's divider can be dragged, and double-clicked to even it out. The pane you are not typing in is dimmed.
- With no sessions yet, the sidebar offers Open a folder, Ask Claude and Ask Codex, and the shortcuts to start with.
- The usage page has a section list that jumps to Limits, This tab's session, Local usage and Breakdown, and follows the scroll. Hovering a chart bar shows its numbers beside it.
- The shortcuts page has a filter box.
- The tab bar and sidebar let the Windows 11 Mica backdrop show through, tinted to the theme.
- The sidebar edge shows a line and grip on hover, so it is clear it can be dragged.
- The sidebar shows placeholder rows while sessions are scanned.
- Right-click shows ATC's own menus only: the terminal gets copy, paste, find, split and tab actions; text boxes and notes get cut, copy and paste; tab rows in the Open view get tab actions. The browser's menu no longer appears.
- The rail is gone. The sidebar toggle sits at the left of the tab bar; + opens a shell, and its arrow starts a shell, Claude or Codex in the current project; a ⋯ menu holds usage, settings, shortcuts and the command palette.
- The tab bar shows how much of your tightest Claude plan limit is used, amber from 80%. Hover it for every Claude and Codex limit and today's spend; click it to open usage.
- Usage opens as a tab after your terminals and stays there until closed; picking a terminal tab switches away from it.
- The command palette lists Usage, Settings and Keyboard shortcuts right after your open tabs.

### Fixed
- Sidebar right-click menus no longer open shifted to the right and cut off at the sidebar edge.
- Claude tab titles no longer show the ✳ twice.
- Expanded projects show their chevron again; it was hidden whenever a project was open.
- The find bar, error message and close confirmation follow light themes instead of staying dark.

## [0.4.3] - 2026-10-15

### Changed
- Model prices update from the repository at launch, so a new model no longer waits for a release. Offline, the built-in table is used.

### Fixed
- Usage prices Codex `gpt-6.1-sol` sessions instead of marking them unpriced.

## [0.4.2] - 2026-10-07

### Added
- Right-click the Open view's tab list to pick a project, then Claude or Codex, and start it there. ([#146](https://github.com/arghya2801/agent-terminal-control/issues/146))
- Tabs in the tab bar show the same state dot as the sidebar: working, needs you, interrupted or idle, for Claude and Codex. ([#149](https://github.com/arghya2801/agent-terminal-control/issues/149))

### Changed
- The notes pad edits formatted text in place: headings, bold, links and checkboxes look formatted while you type, and `notes.md` stays plain Markdown. Type `- [ ] ` for a checkbox, click a box to tick it, Ctrl+click a link to open it. ([#150](https://github.com/arghya2801/agent-terminal-control/issues/150))
- The Claude / Codex picker is a compact sheet at the top of the window. It names the project and path it starts in. Press 1 or 2, or use the arrows and Enter. Esc or a click outside cancels.
- The sidebar opens on the Open view for new installs. ([#146](https://github.com/arghya2801/agent-terminal-control/issues/146))

### Fixed
- The Open view's dots match the Sessions view: needs-you wins over working, and interrupted and not-yet-reported tabs no longer show as idle. ([#148](https://github.com/arghya2801/agent-terminal-control/issues/148))
- Ctrl+C or Ctrl+Shift+C copies the terminal selection. With nothing selected, Ctrl+C still interrupts. ([#145](https://github.com/arghya2801/agent-terminal-control/issues/145))
- Closing a tab activates the tab to its right, or the one to its left when it was the last, instead of the first tab. ([#147](https://github.com/arghya2801/agent-terminal-control/issues/147))

## [0.4.1] - 2026-10-05

### Added
- An Open view in the sidebar lists every tab in tab-bar order, with its state (working, needs you, idle, exited), agent, project and last output time. Click to switch, drag to reorder, middle-click to close. ([#132](https://github.com/arghya2801/agent-terminal-control/issues/132))
- A notes pad under the Open view, stored as `notes.md` in the config directory. It shows raw Markdown while editing and renders otherwise, with checkboxes you can tick in place. ([#140](https://github.com/arghya2801/agent-terminal-control/issues/140))
- The Usage chart splits by provider or by token type (input, output, cache write, cache read), and can draw a 7-day average over the daily bars. ([#27](https://github.com/arghya2801/agent-terminal-control/issues/27))
- A Scratch view in the sidebar lists chats and scratch sessions apart from the projects. Its + starts a plain Claude or Codex chat in ATC's `chats` directory. ([#135](https://github.com/arghya2801/agent-terminal-control/issues/135))
- A weekday-by-hour heatmap on the Usage page shows when in the week the usage happens. ([#27](https://github.com/arghya2801/agent-terminal-control/issues/27))
- More Usage views: a year calendar with active days and streaks, 5-hour blocks like Claude's session limit, the daily cache hit rate, and a Share mode that draws split bars at 100%. ([#27](https://github.com/arghya2801/agent-terminal-control/issues/27))

### Changed
- The installers ship Windows Terminal's ConPTY (`conpty.dll` and `OpenConsole.exe`), and ATC uses it when present. The ConPTY built into Windows swallowed colour queries, so Codex's prompt bar ignored the theme. ([#116](https://github.com/arghya2801/agent-terminal-control/issues/116), [#81](https://github.com/arghya2801/agent-terminal-control/issues/81))

### Removed
- Tasks, the task panel and linked sessions. On first run, existing tasks are copied into `notes.md` as a checklist with their notes indented; `tasks.json` is left on disk. `Ctrl+Shift+E` goes back to the shell. ([#140](https://github.com/arghya2801/agent-terminal-control/issues/140))

### Fixed
- Shift+Enter inserts a line break in Claude Code, as Ctrl+J does, instead of submitting.
- Codex always starts with `--no-daemon`, since its background server often failed to start. ([#133](https://github.com/arghya2801/agent-terminal-control/issues/133))
- Codex plan limits wait up to 30 s per step instead of 15 s, which a cold `codex app-server` could exceed on a busy machine, and a failure now names the step that timed out.
- Usage bars for days under $1 (or under one token) drew short instead of to scale.

## [0.4.0] - 2026-09-29

ATC now runs on a Go/Wails host instead of Rust/Tauri. The interface is the same Svelte and xterm.js app, and settings, tasks, session names and pinned projects carry over unchanged. The installer upgrades an existing 0.3.x install in place.

### Changed
- The desktop host is rewritten in Go on Wails. Building ATC is 7–60x faster and needs about a fifth of the memory, which makes fixes much quicker to ship. Details and measurements are in [docs/WAILS-MIGRATION.md](docs/WAILS-MIGRATION.md).
- Zoom scales the terminal font instead of the rendered page, so terminals stay sharp and correctly sized at every zoom level.
- Developer tools open with `Ctrl+Shift+F12` in development builds.

### Fixed
- An invalid `settings.json` is no longer overwritten with defaults when tasks move to `tasks.json`.
- Subagent transcripts being written no longer trigger constant sidebar rescans, and a live session's transcript is no longer re-read from the top on every write.
- Idle terminals no longer wake the app 125 times a second.
- Very colourful or fast-redrawing output (TUIs, progress bars) is delivered in evenly sized pieces instead of occasional oversized bursts.
- A terminal whose shell exited while its child processes were still writing no longer leaks a background reader.

### Known differences from 0.3.x
- Open tabs are not restored the first time 0.4.0 starts, because the new host keeps its own WebView profile. Reopen them once; later restarts restore them as before.
- The window appears when the interface has loaded, a few seconds after launch, rather than showing an empty frame first.
- ATC uses about 50 MB more memory than 0.3.x, and the executable is larger (12 MB instead of 5 MB).

### For contributors
- Building needs Go 1.26 and the Wails CLI 2.16 instead of Rust: `npm run desktop:dev`, `npm run desktop:build`, and `npm run desktop:package` for the installers. See the README.
- Every Rust test was ported to Go, and the Rust implementation's output over the fixture corpus is kept as a contract the Go tests must match.
- The release workflow checks that the tag matches the version in both `package.json` and `wails.json`.

## [0.3.1] - 2026-09-25

### Added
- Split panes: `Ctrl+Shift+\` shows two terminals side by side, and `Ctrl+Shift+O` moves between them. ([#21](https://github.com/arghya2801/agent-terminal-control/issues/21))
- Drag tabs to reorder them. ([#74](https://github.com/arghya2801/agent-terminal-control/issues/74))
- Reorder tasks within a status group by dragging, or with Alt+Up/Down. ([#104](https://github.com/arghya2801/agent-terminal-control/issues/104))
- Keyboard navigation in the sidebar. Down from the search box, or Tab, enters the list. Arrows move and expand, Enter opens, Shift+F10 opens the menu, and Esc goes back to the terminal. ([#103](https://github.com/arghya2801/agent-terminal-control/issues/103))
- Usage chart: split by model or project, a running total, hourly bars for a single day, and a read-out of the hovered bar. ([#71](https://github.com/arghya2801/agent-terminal-control/issues/71))
- Previous/next-day buttons on the Usage page, and clicking a bar shows that day. ([#76](https://github.com/arghya2801/agent-terminal-control/issues/76))
- A card on the Usage page for the focused tab's session: cost, tokens and cache share by model. ([#80](https://github.com/arghya2801/agent-terminal-control/issues/80))
- Model prices can be added or corrected with a `pricing.json` beside `settings.json`. ([#102](https://github.com/arghya2801/agent-terminal-control/issues/102))
- A `CHANGELOG.md`, backfilled from the release notes. ([#98](https://github.com/arghya2801/agent-terminal-control/issues/98))
- End-to-end tests (`npm run test:e2e`) that drive the built app through tauri-driver and WebDriver, with no desktop input. ([#97](https://github.com/arghya2801/agent-terminal-control/issues/97))
- CI runs tests and lint on every pull request and push to `main`. ([#93](https://github.com/arghya2801/agent-terminal-control/issues/93))

### Changed
- The README covers tasks, themes, split panes, the new shortcuts and the Usage page.
- Tasks are stored in `tasks.json` beside `settings.json`. Existing tasks move over on first start. ([#99](https://github.com/arghya2801/agent-terminal-control/issues/99))
- Changing a setting that does not affect the sidebar (font, zoom, theme, view) no longer restarts the transcript watcher or rescans. ([#87](https://github.com/arghya2801/agent-terminal-control/issues/87), [#100](https://github.com/arghya2801/agent-terminal-control/issues/100))
- The release workflow uses the current majors of its actions and builds on Node 24. ([#94](https://github.com/arghya2801/agent-terminal-control/issues/94))
- A bare `svelte-check` now checks the app, the same as `npm run check`. ([#95](https://github.com/arghya2801/agent-terminal-control/issues/95))
- `playground/` is ignored by git. ([#96](https://github.com/arghya2801/agent-terminal-control/issues/96))

### Fixed
- Switching tabs and sidebar views is faster. WebGL contexts are kept for recent tabs, and both sidebar views stay mounted. ([#117](https://github.com/arghya2801/agent-terminal-control/issues/117))
- A session reached with `/resume` inside an open tab is linked to that tab, so the sidebar focuses it instead of opening a second tab. ([#75](https://github.com/arghya2801/agent-terminal-control/issues/75))
- Shift+Enter and Ctrl+J insert a newline in Codex again instead of sending the prompt. ([#82](https://github.com/arghya2801/agent-terminal-control/issues/82))
- Codex starts when ATC runs inside a Windows Job Object that forbids breakaway, such as IntelliJ's terminal. ATC launches it with `--no-daemon` there. ([#118](https://github.com/arghya2801/agent-terminal-control/issues/118))
- A tab whose agent has exited closes without asking. A plain shell with something running under it now asks, and names what would be stopped. ([#106](https://github.com/arghya2801/agent-terminal-control/issues/106))
- Escape closes the Usage, Settings and Shortcuts pages. ([#105](https://github.com/arghya2801/agent-terminal-control/issues/105))
- A misconfigured Codex command shows an error on the Usage page instead of hiding the Codex card. ([#90](https://github.com/arghya2801/agent-terminal-control/issues/90))
- Saving the Settings page no longer overwrites task edits made while it was open. ([#86](https://github.com/arghya2801/agent-terminal-control/issues/86))
- **New task from this session** no longer leaves the session linked to its old task too. ([#88](https://github.com/arghya2801/agent-terminal-control/issues/88))
- The task branch picker fetches fresh each time it opens, and no longer flashes existing branches as deleted. ([#91](https://github.com/arghya2801/agent-terminal-control/issues/91))
- Links in task notes open correctly when they contain commas or `*`. ([#92](https://github.com/arghya2801/agent-terminal-control/issues/92))
- A task state that is not a string (`null`, a number) no longer resets every setting. ([#89](https://github.com/arghya2801/agent-terminal-control/issues/89))

## [0.3.0] - 2026-09-24

### Added
- **Local tasks** ([#84](https://github.com/arghya2801/agent-terminal-control/pull/84), [#69](https://github.com/arghya2801/agent-terminal-control/issues/69)):
  - a Tasks view in the sidebar (`Ctrl+Shift+K`), grouped as In progress, To do and Done
  - tasks linked to a project, its branches and the Claude and Codex sessions that ran on them
  - a task panel (`Ctrl+Shift+E`) with a branch picker, suggested sessions and Markdown notes
- **Group by branch** in Settings.
- Middle-click closes a tab, confirming first when something is running. ([#83](https://github.com/arghya2801/agent-terminal-control/pull/83))

### Fixed
- Shells no longer inherit Claude Code's session markers from wherever ATC was launched. ([#72](https://github.com/arghya2801/agent-terminal-control/issues/72))
- Claude or Codex is no longer reported missing when PowerShell can run it (`.ps1` shims, aliases, tools installed later). ([#79](https://github.com/arghya2801/agent-terminal-control/issues/79))
- Codex commands no longer carry an extra `-c tui.keymap...` override.
- The Usage page hides the Codex card when Codex is not installed. Codex limits refresh every 5 minutes.
- Edits to `settings.json` apply live with a relative `ATC_CONFIG_DIR`. ([#67](https://github.com/arghya2801/agent-terminal-control/issues/67))

## [0.2.0] - 2026-09-23

### Added
- **Codex support** ([#77](https://github.com/arghya2801/agent-terminal-control/pull/77)):
  - Codex conversations are discovered next to Claude sessions and can be opened and resumed in tabs.
  - The Codex command and home directory are configurable.
  - The Usage page shows separate Claude and Codex limits, and local usage by provider as tokens or estimated API cost, with CSV export.

### Fixed
- Codex usage no longer recounts older cumulative snapshots.
- Shells no longer inherit `NO_COLOR`, and `TERM=xterm-256color` is set. ([#72](https://github.com/arghya2801/agent-terminal-control/issues/72))
- With overflowing tabs, `+` stays visible and scroll buttons and the wheel reach hidden tabs. ([#78](https://github.com/arghya2801/agent-terminal-control/pull/78))

## [0.1.3] - 2026-09-19

### Added
- Themes for the whole app: ATC Dark, Nord, Rosé Pine, Catppuccin Mocha and Latte, plus your own in a `themes/` folder. ([#4](https://github.com/arghya2801/agent-terminal-control/issues/4))
- A keyboard shortcut list (`Ctrl+Shift+?`). ([#57](https://github.com/arghya2801/agent-terminal-control/issues/57))
- **Last N days** and a **Custom** slot on the Usage page. ([#58](https://github.com/arghya2801/agent-terminal-control/issues/58))
- Optional **Group subfolders** in the sidebar. ([#2](https://github.com/arghya2801/agent-terminal-control/issues/2))

### Fixed
- The sidebar highlights a new Claude session without a restart. ([#56](https://github.com/arghya2801/agent-terminal-control/issues/56), [#53](https://github.com/arghya2801/agent-terminal-control/issues/53))
- The Usage page no longer jumps on load. ([#55](https://github.com/arghya2801/agent-terminal-control/issues/55))
- A flaky PTY test. ([#51](https://github.com/arghya2801/agent-terminal-control/issues/51))

## [0.1.2] - 2026-09-17

### Added
- Sidebar filter (`Ctrl+Shift+P`), activity dots on sessions with open tabs, and a resizable sidebar. ([#22](https://github.com/arghya2801/agent-terminal-control/issues/22), [#12](https://github.com/arghya2801/agent-terminal-control/issues/12), [#3](https://github.com/arghya2801/agent-terminal-control/issues/3))
- Tabs reopen on the next launch. ([#6](https://github.com/arghya2801/agent-terminal-control/issues/6))
- An in-app confirmation before closing a running tab. ([#23](https://github.com/arghya2801/agent-terminal-control/issues/23))
- Windows notifications for background sessions. ([#24](https://github.com/arghya2801/agent-terminal-control/issues/24))
- **Ask Claude** in a scratch directory. ([#30](https://github.com/arghya2801/agent-terminal-control/issues/30))
- Usage:
  - plan limits auto-refresh, and the date range is remembered ([#19](https://github.com/arghya2801/agent-terminal-control/issues/19))
  - spend can be grouped by model or session, with CSV export ([#26](https://github.com/arghya2801/agent-terminal-control/issues/26))
  - incremental transcript reads ([#18](https://github.com/arghya2801/agent-terminal-control/issues/18))
- Keyboard shortcuts for common actions. ([#25](https://github.com/arghya2801/agent-terminal-control/issues/25))
- Releases are built by GitHub Actions. ([#20](https://github.com/arghya2801/agent-terminal-control/issues/20))

### Fixed
- Sessions show the name Claude gives them. ([#29](https://github.com/arghya2801/agent-terminal-control/issues/29))
- Plan usage works behind corporate proxies (Windows certificate store). ([#28](https://github.com/arghya2801/agent-terminal-control/issues/28))
- `Ctrl+Shift+W` confirms before closing a running tab. ([#23](https://github.com/arghya2801/agent-terminal-control/issues/23))

## [0.1.1] - 2026-09-16

### Added
- Open Claude or a terminal in a project from its context menu. ([#14](https://github.com/arghya2801/agent-terminal-control/issues/14), [#11](https://github.com/arghya2801/agent-terminal-control/issues/11))
- Rename projects, sessions and tabs. ([#9](https://github.com/arghya2801/agent-terminal-control/issues/9), [#13](https://github.com/arghya2801/agent-terminal-control/issues/13))
- Tab titles follow the program, and open projects are marked.
- A Settings page ([#5](https://github.com/arghya2801/agent-terminal-control/issues/5), [#1](https://github.com/arghya2801/agent-terminal-control/issues/1)). A Usage page with plan limits and API-price spend ([#7](https://github.com/arghya2801/agent-terminal-control/issues/7), [#8](https://github.com/arghya2801/agent-terminal-control/issues/8)).

### Fixed
- Copying from Claude Code (OSC 52) and `Ctrl+V` paste inside Claude Code. ([#10](https://github.com/arghya2801/agent-terminal-control/issues/10))

## [0.1.0] - 2026-09-06

First release.

[Unreleased]: https://github.com/arghya2801/agent-terminal-control/compare/v0.7.4...HEAD
[0.7.4]: https://github.com/arghya2801/agent-terminal-control/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/arghya2801/agent-terminal-control/compare/v0.7.2-beta...v0.7.3
[0.7.2-beta]: https://github.com/arghya2801/agent-terminal-control/compare/v0.7.1...v0.7.2-beta
[0.7.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/arghya2801/agent-terminal-control/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/arghya2801/agent-terminal-control/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/arghya2801/agent-terminal-control/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/arghya2801/agent-terminal-control/releases/tag/v0.1.0
