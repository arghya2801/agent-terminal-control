# ATC (Agent Terminal Control)

Windows app. Sidebar of Claude Code and Codex sessions, real ConPTY terminal on the right. Code map in ARCHITECTURE.md.

Go + Wails v2 host (`app.go`, `internal/`), Svelte 5 + TS + xterm.js 6 frontend. Rust/Tauri is gone. Don't bring back `src-tauri`.

## Commands

- `npm run play`: dev app on fixture data. Use this by default.
- `npm run desktop:dev`: dev app on real `~/.claude/projects`.
- `npm test`, `npm run lint`: run both before any PR.
- `npm run test:e2e`: local only, needs a desktop.
- `main.go` embeds `dist/`. Run `npm run build` before bare `go build` or `go test`.

## Rules

- Keep it small. 5 lines beats 50. No comments that repeat the code, no features nobody asked for.
- One branch and PR per group of issues. Small conventional commits. Merge, delete branch, close issues with `Fixes #N`.
- Stacked PRs: merge the base without `--delete-branch`, retarget the next PR, then delete.
- Add a CHANGELOG.md line for every user-visible change.
- Test in the dev app, not only with unit tests.
- Docs are dry and plain. No personal names in paths or docs.

## Releases

- Never tag or release until I've used the build and said go.
- Bump `package.json` and `wails.json` versions together. CI rejects a mismatch.
- Push a `v*` tag. CI builds a draft with the MSI, setup.exe and portable `atc.exe`. Publish the draft after `gh run watch` passes. Never `gh release create` with local files.
- MSI is the recommended installer.

## Checking the UI

- `scripts/shot.ps1` screenshots without focus. `scripts/sendkeys.ps1` steals my focus, so use it rarely.
- Never kill the installed `atc.exe`. My Claude session may be in it. The dev build is `atc-dev`.
- Blank pane after an edit means restart the dev server.

## Gotchas

- Hook terminal input up before spawning the PTY, or ConPTY hangs on its ESC[6n request.
- Spawn the PTY after layout settles, at real size. An early resize garbles resumed transcripts.
- Hide panes with `visibility: hidden`. `display: none` breaks FitAddon.
- Runes only work in `.svelte` and `.svelte.ts`. Never export anything named `state`.
- Don't claim plain Ctrl+B in the keymap. Claude uses it.
- Read `cwd` from session JSONL. Never decode project dir names.
- Child shells must not inherit `NO_COLOR`, and need `TERM=xterm-256color` (`internal/pty/pty_windows.go`). Break this and oh-my-posh renders black.
- `wails-dev-work/` is generated. Don't edit it.
- Bash heredocs drop backslashes here. Use Write/Edit for paths and regexes.
