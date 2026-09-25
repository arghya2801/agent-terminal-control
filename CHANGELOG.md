# Changelog

Notable changes to ATC. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Add a line under **Unreleased** in each PR. When cutting a release, rename that section to the version and paste it into the GitHub release body.

## [Unreleased]

### Added
- Usage chart: split by model or project, a running total, hourly bars for a single day, and a read-out of the hovered bar. ([#71](https://github.com/arghya2801/agent-terminal-control/issues/71))
- Previous/next-day buttons on the Usage page, and clicking a bar shows that day. ([#76](https://github.com/arghya2801/agent-terminal-control/issues/76))
- A card on the Usage page for the focused tab's session: cost, tokens and cache share by model. ([#80](https://github.com/arghya2801/agent-terminal-control/issues/80))
- Model prices can be added or corrected with a `pricing.json` beside `settings.json`. ([#102](https://github.com/arghya2801/agent-terminal-control/issues/102))
- A `CHANGELOG.md`, backfilled from the release notes. ([#98](https://github.com/arghya2801/agent-terminal-control/issues/98))
- CI runs tests and lint on every pull request and push to `main`. ([#93](https://github.com/arghya2801/agent-terminal-control/issues/93))

### Changed
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

[Unreleased]: https://github.com/arghya2801/agent-terminal-control/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/arghya2801/agent-terminal-control/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/arghya2801/agent-terminal-control/releases/tag/v0.1.0
