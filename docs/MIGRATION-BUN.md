# Migration: Node to Bun

From the release after 0.7.7, ATC uses Bun where it used Node: to run agent chat tabs, and to build and test ATC. The Go app, the terminal tabs and the Vite + Svelte frontend are unchanged. Bun runs Vite and Vitest.

## For users

### What changes

- **Nothing to install for agent chats.** Before, chat tabs needed Node.js 18 or later on PATH and showed "Agent sessions need Node.js" without it. Now ATC picks a runtime by itself, in this order:
  1. `bun` on PATH, if it is 1.4.0 or later.
  2. ATC's own Bun. The first chat that needs it downloads Bun 1.4.5 (a 54 MB zip, 115 MB unpacked) into `%APPDATA%\Agent Terminal Control\runtime\bun-1.4.5\`. While it downloads, the chat shows "Downloading the agent runtime, X of Y MB". It happens once per Bun version.
  3. `node` on PATH, 18 or later. This is used only when the download fails, so a machine that used Node before keeps working offline.
- **Terminal tabs** never use a runtime and are unchanged.
- **Installers** are the same size. Bun is not bundled.

### Settings

Settings > Agents > Runtime (`agent.runtime` in settings.json):

| Value | Meaning |
|---|---|
| `auto` (default) | The order above. |
| `bun` | Bun on PATH, else ATC's own Bun. Never Node. |
| `node` | Node on PATH only: the old behaviour. |
| a path | That program, e.g. `C:\Tools\bun\bun.exe`. |

The field's hint shows the runtime in use once a chat has started.

### Offline machines, proxies and policy

- The download comes from `https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/`. ATC checks it against SHA-256 hashes built into ATC before running it. A file that doesn't match is deleted and never run.
- Proxies: the download honours `HTTPS_PROXY`. It does not read the Windows system proxy settings.
- If GitHub is blocked, install Bun yourself (`winget install Oven-sh.Bun`) or keep Node installed, or point Runtime at an approved executable.
- If the download fails and there is no Node, the chat says "couldn't get the agent runtime: … Install Bun, set Settings > Agents > Runtime, or open the session in a terminal".

### Going back to Node

Set Runtime to `node`. You can then delete `%APPDATA%\Agent Terminal Control\runtime\` to free the space.

## For contributors

### Setup

Install Bun 1.4 or later (`winget install Oven-sh.Bun`). Go, WebView2, NSIS and WiX are as before. Node is no longer needed.

| Before | Now |
|---|---|
| `npm ci` | `bun install` (CI: `bun install --frozen-lockfile`) |
| `npm run play` | `bun run play` |
| `npm run desktop:dev` | `bun run desktop:dev` |
| `npm test` | `bun run test` (not `bun test`, which is Bun's own test runner) |
| `npm run lint` | `bun run lint` |
| `npm run build` | `bun run build` |
| `npm run desktop:build` / `desktop:package` | `bun run desktop:build` / `desktop:package` |
| `npm run bindings` | `bun run bindings` |
| `npm run test:e2e` | `bun run test:e2e` |
| `npx vite` | `bunx vite` |

### What moved

- **Lockfile:** `bun.lock` replaces `package-lock.json`. It resolves the same 453 package versions. Add dependencies with `bun add`.
- **`bunfig.toml`:** `[run] bun = true` makes package scripts and bins (Vite, Vitest, svelte-check, tsc) run on Bun even where Node is installed.
- **Install scripts:** `bun install` blocks one postinstall script, `edgedriver`'s driver download. The e2e runner downloads its own driver, so it isn't needed.
- **`wails.json`:** the frontend commands run `bun install --frozen-lockfile`, `bun run build` and `bun run dev`.
- **e2e:** `e2e/run.mjs` runs the suite with `bun test`, with a 10-minute timeout, instead of `node --test`.
- **CI and release:** `oven-sh/setup-bun` pinned to 1.4.5 (the same Bun that `runtime.go` downloads) and a cache of `~/.bun/install/cache` keyed on `bun.lock`. `setup-node` is gone. The release version check uses `bun -p`.
- **Sidecar:** the code is unchanged except for one line in `claude.ts`. A Claude CLI installed by npm as a `.js` file is now run with whichever runtime runs the sidecar. It is still built by Vite into `dist/sidecar/agent.mjs`, and Bun runs that file or `sidecar/agent.ts` directly.
- **Go:**
  - `runtime.go` (new) picks the runtime, and downloads and verifies Bun.
  - `agents.go` starts the sidecar with it. It resolves the runtime outside the sidecar lock, so a download doesn't block other agent calls.
  - `AgentRuntimeInUse` feeds the Settings hint.
  - The default for `agent.runtime` is in `internal/core/settings.go`.

### Updating the pinned Bun

```
bun scripts/pin-bun.mjs 1.4.6
```

This prints `bunVersion` and the two SHA-256 hashes (for x64, and baseline for CPUs without AVX2) from that release's `SHASUMS256.txt`. Then:

1. Paste them into `runtime.go`.
2. Set `bun-version` in both workflows to the same version.
3. Run the agent chat checks below on the new version before raising `bunMin`.

## How it was verified

All on Windows 11 with Bun 1.4.5, 2026-11-28. The UI was driven through `scripts/drive.mjs`, with real Claude (haiku) and Codex (gpt-5.6-luna) chats.

**Tooling**

| Check | Result |
|---|---|
| `bun install` vs `npm ci` | 90 s cold, 45 s from cache, 0.5 s with no change, vs 140 s. `node_modules` is 522 MB vs 552 MB. |
| Resolved versions | `bun.lock` matches `package-lock.json`: all 453 packages at the same versions. |
| `bun run build` | 9 s (Vite on Bun). |
| `bun run test` | 319 Vitest tests and all Go tests pass. |
| `bun run lint` | go vet, gofmt and svelte-check: 0 errors, 0 warnings. |
| `bun run bindings` | No change to `wailsjs/go` beyond the new method. |
| `bun run desktop:build` / `desktop:package` | `atc.exe`, the setup.exe (4.9 MB) and the MSI (6.5 MB) build. The installers are no larger. |
| No Node at all | build, test, lint, bindings and desktop:build all pass with Node removed from PATH. |

**Chats, Node vs Bun as the sidecar runtime** (same tests on each)

| Test | Node | Bun |
|---|---|---|
| Claude chat: open, reply, close | pass | pass |
| Codex chat, and no `codex.exe` left after close | pass | pass |
| Close a chat whose CLI died | 5 ms | 7 ms |
| 5 MB image sent while another chat streams: longest pause in the stream | 70 ms | 89 ms |
| Sidecar killed: no `codex.exe` left, and the next chat restarts it | pass | pass |
| Codex installed by npm (`codex.js` run by the sidecar's runtime) | pass | pass |
| Model lists: Claude / Codex | 14 / 10 | 14 / 10 (same ids) |

**Runtime selection and download**

| Test | Result |
|---|---|
| `auto` with Bun on PATH | Uses the PATH `bun.exe`. Settings shows "In use: …\bun.exe". |
| `auto` with no Bun or Node | Downloads 54.4 MB in about 3 s. The chat shows "Downloading the agent runtime, X of 54 MB", then "Unpacking the agent runtime", then the chat. `bun.exe` is 115 MB under `<config>\runtime\bun-1.4.5\`. The next chat doesn't download again. |
| `auto`, offline, no Node | The chat exits with "couldn't get the agent runtime: … Install Bun, set Settings > Agents > Runtime, or open the session in a terminal". |
| `auto`, offline, Node present | Falls back to `node.exe`, and the chat works. |
| `node` | Uses `node.exe` even with Bun on PATH. |
| `bun`, offline, Node present | Errors and does not use Node. |
| Production build (embedded `agent.mjs`) | `bun.exe <config>\sidecar\agent.mjs` runs the chat. |
| Go unit tests (`runtime_test.go`) | Download, checksum rejection (nothing left behind), a zip with `..` entries writes only `bun.exe`, concurrent chats download once, the runtime order for each setting, version comparison. |

Not run here: CI on GitHub's runners (the workflows parse; the first PR run is their real test), and `bun run test:e2e` (it takes window focus, and the suite already failed 17 of 30 tests before this change).

## Known limits

- The download needs github.com, and does not use the Windows system proxy.
- `bun` on PATH below 1.4.0 is skipped rather than used. The version is read once per app run, so a newly installed Bun is picked up after a restart.
- An npm install of Claude Code 2.1.0 (`cli.js`) fails on both runtimes, because that CLI doesn't know `--effort`. Current npm installs ship a native `claude.exe` and no `cli.js`. ATC's `.cmd` mapping in `agents.go` (`agentExe`) looks for `cli.js` and doesn't find it, so it hands the SDK the `.cmd` shim, which the SDK can't start. This was already the case before this change and is not caused by Bun.

## Rollback

Revert the change. Users who already downloaded ATC's Bun can delete `%APPDATA%\Agent Terminal Control\runtime\`. Nothing else outside the repo was changed.
