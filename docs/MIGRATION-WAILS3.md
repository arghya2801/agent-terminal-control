# Migration: Wails v2.17.1 to v3.1.0

The desktop host moved from Wails v2 to Wails v3.1.0 (released 2026-11-01, pinned exactly). The UI, the Go code behind it and the installers are otherwise unchanged.

## For users

Nothing changes. The window, Mica/Acrylic backdrop, light and dark title bar, notifications, the `--open` second launch, dialogs and installers work as before. The WebView2 profile stays in `webview-wails`, so saved tabs and pane sizes carry over.

One detail: a dev or renamed build sends notifications as "ATC (<exe name>)" rather than "ATC", so clicking a toast reaches the copy that sent it.

## For contributors

### Setup

`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` replaces the v2 `wails` CLI. It is needed for `bun run bindings` and `bun run desktop:build`.

| Before (v2) | Now (v3) |
|---|---|
| `wails.Run(&options.App{…})` | `application.New(Options)`, then `app.Window.NewWithOptions(…)`, then `app.Run()` (`main.go`) |
| `Bind: [app]` | `Services: [application.NewService(app), application.NewService(notifier)]` |
| `OnStartup` / `OnDomReady` / `OnShutdown` | `App.ServiceStartup` / (none) / `App.ServiceShutdown`, plus a `WindowClosing` hook that calls `app.Quit()` |
| `wr.EventsEmit(ctx, …)` | `app.Event.Emit(…)` |
| `window.runtime.EventsOn(name, cb(v))` | `Events.On(name, cb(ev))` from `@wailsio/runtime`, payload `ev.data` (`src/lib/desktop.ts`) |
| `wailsjs/go/main/App` | `src/bindings/atc/app.ts`, used through `src/lib/bound.ts` |
| Rejections are strings | Rejections are `Error`s; `bound.ts` turns them back into the Go message |
| `WindowSetLightTheme` / `WindowSetDarkTheme` | `App.SetWindowTheme(light)`, which calls `w32.SetTheme` on the window |
| `wr.SaveFileDialog`, `wr.OpenDirectoryDialog` | `app.Dialog.SaveFileWithOptions` / `OpenFileWithOptions{CanChooseDirectories}` |
| `wr.*Notification*` | the `notifications` service |
| `SingleInstanceLock` | `SingleInstance` |
| `wails generate module` | `wails3 generate bindings -ts -d src/bindings` (`bun run bindings`) |
| `wails build -s …` | `wails3 generate syso` (icon, manifest and version info from `build/windows` and `wails.json`) + `go build -tags production` (`scripts/build.mjs`) |
| `wails dev` over a `wails-dev-work/` mirror | `scripts/dev-host.mjs`: Vite + `go build` + the exe with `FRONTEND_DEVSERVER_URL`, rebuilt when Go changes |
| Driver: `-tags dev` exe on :34115 | Driver: `-tags server` exe on :34115 (no window), opened in headless Edge |
| e2e: patched `go-webview2` loader | `ATC_DEBUG_PORT` → `Windows.AdditionalBrowserArgs` |

`wails.json` now only carries `info` (version, product, company). `main.go`, the tests, release CI and `scripts/build.mjs` read it. Bump its version with `package.json` as before.

### Workarounds for v3 issues

- **wails#6368:** on Windows, closing the last window ends `Run()` without the shutdown hooks, which would leave shells and the sidecar running. `main.go` hooks `WindowClosing` and calls `app.Quit()`. Verified: 12 child processes before closing, none after.
- **No runtime theme API:** `SetWindowTheme` sets the window's dark mode attribute directly.
- **Dev proxy dials IPv4:** Vite listens on `127.0.0.1` (`vite.config.ts`).
- **A hidden window renders no frames:** the driver uses the `server` build in headless Edge rather than a hidden desktop window.
- **Early reload:** when the driver attaches, it navigates to the page rather than reloading it. A reload during v3's first navigation reloads `about:blank`.

## How it was verified

On Windows 11, 2026-11-28.

| Check | Result |
|---|---|
| Spike: bindings generated from package `main` | 2 services, 72 methods, 14 models; `core.Object`, `any` and the model classes are usable |
| `bun run test` | 324 Vitest tests (including new transport tests for events, unsubscribe and error messages) and all Go tests |
| `bun run lint` | go vet, gofmt and svelte-check: 0 errors, 0 warnings |
| `bun run bindings` | no drift from the committed `src/bindings` |
| `bun run desktop:build` | `atc.exe` 15.5 MB (v2: 14.8 MB); version info identical to the installed v2 exe |
| `bun run desktop:package` | setup.exe 5.1 MB, MSI 6.7 MB (v2: 4.9 and 6.5 MB) |
| `bun run play` | starts; saving a Go file rebuilds and restarts the app; closing the window stops Vite too |
| Full in-app regression through the driver | same results as v2: every customization check, settings, rename, archive, notes, file editor, search, usage page, events, the runtime download, live Claude and Codex chats, dead-CLI close, image while streaming, sidecar restart, terminal, fast close |
| Go errors in the UI | plain Go text, no "RuntimeError" |
| Real window (desktop build, CDP + Win32 messages) | DWM backdrop type 2 (Mica); dark-mode attribute 1 → 0 → 1 with the theme switch; notification sent; second launch with `--open` exits in under 0.5 s and the first copy opens the folder; WM_CLOSE leaves no child processes; no page errors |
| Terminal speed, desktop window (3 runs) | keystroke echo p50 311–321 ms (v2: 298–334 ms); 20,000 lines 5.8–8.8 s (v2: 6.3–7.0 s) |
| Terminal speed, server build (3 runs) | echo p50 274–307 ms; 20,000 lines 5.5–6.4 s |

The echo time is mostly PowerShell's line editor and the prompt redrawing. Wails adds about the same on both versions.

Not run: clicking a notification (needs a person), the native dialogs' cancel path (needs a person), and `bun run test:e2e` (takes focus; the suite already failed 17 of 30 tests before this change).

### Check before release

Use the built exe before tagging:
- Click a notification while ATC runs, and after it closes.
- Cancel a Save dialog and a folder dialog.
- Switch a light theme and look at the title bar tint.
- Install the MSI over the current version and check that saved tabs come back.

## Rollback

Revert the merge. v2 and v3 have different module paths, so nothing of v3 remains.
