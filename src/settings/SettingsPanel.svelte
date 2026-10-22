<script lang="ts">
  import { onDestroy } from 'svelte';
  import { sessionKey } from '../lib/agents';
  import Page from '../lib/Page.svelte';
  import SectionNav from '../lib/SectionNav.svelte';
  import { openSettingsFile } from '../lib/ipc';
  import { appState, refresh, saveSettings, themeState } from '../lib/stores.svelte';
  import { cssVariables } from '../lib/theme';
  import type { Settings } from '../types';

  let { onClose }: { onClose: () => void } = $props();

  const SECTIONS = [
    { id: 's-general', label: 'General' },
    { id: 's-appearance', label: 'Appearance' },
    { id: 's-terminal', label: 'Terminal' },
    { id: 's-sidebar', label: 'Sidebar' },
    { id: 's-agents', label: 'Agents' },
    { id: 's-names', label: 'Names' },
    { id: 's-advanced', label: 'Advanced' },
  ];

  /** What the fields show. Saved a moment after each edit, cleaned up on the way out. */
  let draft = $state<Settings | null>(
    appState.settings ? structuredClone($state.snapshot(appState.settings)) : null,
  );
  // Arguments are edited one per line. A blank line is dropped, so an empty argument,
  // as in Claude's `--tools ""`, is written as "".
  const joinArgs = (args: string[] | undefined) => (args ?? []).map((a) => (a === '' ? '""' : a)).join('\n');
  function splitArgs(s: string): string[] {
    return s
      .split('\n')
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0)
      .map((arg) => (arg === '""' || arg === "''" ? '' : arg));
  }
  let resumeArgs = $state(joinArgs(appState.settings?.claude.resumeArgs));
  let codexResumeArgs = $state(joinArgs(appState.settings?.codex.resumeArgs));
  let claudeArgs = $state(joinArgs(appState.settings?.claude.args));
  let codexArgs = $state(joinArgs(appState.settings?.codex.args));
  let claudeChatArgs = $state(joinArgs(appState.settings?.claude.chatArgs));
  let codexChatArgs = $state(joinArgs(appState.settings?.codex.chatArgs));
  let saved = $state(false);
  const projects = $derived(appState.index.projects.filter((p) => p.path && p.exists));

  /** Three swatches per theme: the chrome, the accent and the foreground. */
  function swatches(name: string) {
    const t = themeState.themes.find((x) => x.name === name);
    if (!t) return [];
    const v = cssVariables(t);
    return [t.background, v['--accent'], t.foreground];
  }

  const clamp = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

  /** The draft as it goes to disk: numbers clamped, blanks back to their defaults. */
  function cleaned(draft: Settings): Settings {
    return {
      ...draft,
      ui: {
        ...draft.ui,
        sessionsPerProject: clamp(draft.ui.sessionsPerProject, 1, 500, 15),
        sidebarWidth: clamp(draft.ui.sidebarWidth, 160, 800, 260),
        toastSeconds: clamp(draft.ui.toastSeconds, 1, 60, 6),
        limitsRefreshSec: clamp(draft.ui.limitsRefreshSec, 15, 3600, 90),
        codexRefreshSec: clamp(draft.ui.codexRefreshSec, 15, 3600, 300),
      },
      terminal: {
        ...draft.terminal,
        fontSize: clamp(draft.terminal.fontSize, 6, 48, 13),
        scrollback: clamp(draft.terminal.scrollback, 0, 1_000_000, 10_000),
        lineHeight: Number.isFinite(draft.terminal.lineHeight) ? Math.min(2, Math.max(1, draft.terminal.lineHeight)) : 1,
        gpuTabs: clamp(draft.terminal.gpuTabs, 0, 12, 4),
      },
      codex: {
        ...draft.codex,
        command: draft.codex.command.trim() || 'codex',
        args: splitArgs(codexArgs),
        chatArgs: splitArgs(codexChatArgs),
        resumeArgs: splitArgs(codexResumeArgs),
        homeDir: draft.codex.homeDir?.trim() || null,
      },
      claude: {
        ...draft.claude,
        command: draft.claude.command.trim() || 'claude',
        args: splitArgs(claudeArgs),
        chatArgs: splitArgs(claudeChatArgs),
        resumeArgs: splitArgs(resumeArgs),
        scratchDir: draft.claude.scratchDir?.trim() || null,
      },
      projects: {
        ...draft.projects,
        claudeProjectsDir: draft.projects.claudeProjectsDir?.trim() || null,
      },
    };
  }

  /**
   * The draft is not rewritten with the cleaned copy: a width typed as "3" on the way to
   * "300" would be snapped to 160 mid-keystroke.
   */
  async function save() {
    clearTimeout(pending);
    const prev = appState.settings;
    if (!draft || !prev) return;
    const next = cleaned(draft);
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    await saveSettings(next);
    // Renames and the projects directory only show up after a rescan, which is not free.
    const scanned = (s: Settings) => JSON.stringify([s.projects.names, s.projects.sessionNames, s.projects.claudeProjectsDir]);
    if (scanned(next) !== scanned(prev)) await refresh();
    saved = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved = false), 1500);
  }

  let pending: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read everything that is saved, so any edit schedules a save.
    void JSON.stringify(draft);
    void [resumeArgs, codexResumeArgs, claudeArgs, codexArgs, claudeChatArgs, codexChatArgs];
    pending = setTimeout(() => void save(), 300);
    return () => clearTimeout(pending);
  });
  // Closing writes whatever is still waiting.
  onDestroy(() => void save());

  function removeName(field: 'names' | 'sessionNames', id: string) {
    if (!draft) return;
    const map = { ...draft.projects[field] };
    delete map[id];
    draft.projects[field] = map;
  }

  function sessionLabel(id: string): string {
    const shortId = id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9);
    for (const p of appState.index.projects) {
      if (p.sessions.some((s) => sessionKey(s) === id)) return `${p.name} · ${shortId}`;
    }
    return shortId;
  }
</script>

<Page title="Settings" modal {onClose}>
  {#snippet actions()}
    {#if saved}<span class="muted saved">Saved</span>{/if}
    <button class="btn" onclick={() => openSettingsFile()}>Open settings.json</button>
  {/snippet}
  {#if !draft}
    <p class="err">Settings could not be loaded.</p>
  {:else}
    <SectionNav sections={SECTIONS}>
      <h2 id="s-general">General</h2>
      <div class="grid">
        <label for="rt">Restore tabs</label>
        <label class="check">
          <input id="rt" type="checkbox" bind:checked={draft.ui.restoreTabs} />
          <span class="muted">Reopen last time's tabs on launch; agent sessions resume</span>
        </label>
        <label for="nt">Notifications</label>
        <label class="check">
          <input id="nt" type="checkbox" bind:checked={draft.ui.notifications} />
          <span class="muted">When a background session finishes or needs you and ATC is not focused</span>
        </label>
      </div>

      <h2 id="s-appearance">Appearance</h2>
      <div class="grid">
        <label for="th">Theme</label>
        <div>
          <select id="th" bind:value={draft.ui.theme}>
            {#each themeState.themes as t (t.name)}
              <option value={t.name}>{t.name}</option>
            {/each}
          </select>
          <span class="swatches" aria-hidden="true">
            {#each swatches(draft.ui.theme) as colour (colour)}
              <span class="swatch" style="background: {colour}"></span>
            {/each}
          </span>
          <div class="muted hint">Applies as you pick. More themes: any terminal palette in <code>themes/</code> beside <code>settings.json</code>.</div>
        </div>
        <label for="an">Animations</label>
        <div>
          <select id="an" bind:value={draft.ui.animations}>
            <option value="system">Follow Windows</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <span class="muted hint">Windows: Accessibility &gt; Visual effects</span>
        </div>
        <label for="as">Animation speed</label>
        <div class="check">
          <input id="as" type="range" min="0.5" max="3" step="0.25" bind:value={draft.ui.animationSpeed} />
          <span class="speed">{draft.ui.animationSpeed}×</span>
          {#if draft.ui.animationSpeed !== 1}
            <button class="btn" onclick={() => draft && (draft.ui.animationSpeed = 1)}>Reset</button>
          {/if}
        </div>
        <label for="urt">Usage reset time</label>
        <label class="check">
          <input id="urt" type="checkbox" bind:checked={draft.ui.usageResetTime} />
          <span class="muted">Show when the 5-hour limit resets, beside the usage chip</span>
        </label>
        <label for="stb">Tab bar</label>
        <label class="check">
          <input id="stb" type="checkbox" bind:checked={draft.ui.showTabBar} />
          <span class="muted">Show tabs across the top, as well as in the sidebar's Open view</span>
        </label>
        <label for="zm">Zoom</label>
        <input id="zm" type="number" min="0.5" max="3" step="0.1" bind:value={draft.ui.zoom} />
      </div>

      <h2 id="s-terminal">Terminal</h2>
      <div class="grid">
        <label for="ff">Font family</label>
        <input id="ff" class="wide" bind:value={draft.terminal.fontFamily} />
        <label for="fs">Font size</label>
        <input id="fs" type="number" min="6" max="48" bind:value={draft.terminal.fontSize} />
        <label for="sb">Scrollback lines</label>
        <input id="sb" type="number" min="0" step="1000" bind:value={draft.terminal.scrollback} />
        <label for="cs">Cursor</label>
        <div class="check">
          <select id="cs" bind:value={draft.terminal.cursorStyle}>
            <option value="bar">Bar</option>
            <option value="block">Block</option>
            <option value="underline">Underline</option>
          </select>
          <label class="check"><input type="checkbox" bind:checked={draft.terminal.cursorBlink} /> Blink</label>
        </div>
        <label for="lh">Line height</label>
        <input id="lh" type="number" min="1" max="2" step="0.05" bind:value={draft.terminal.lineHeight} />
      </div>

      <h2 id="s-sidebar">Sidebar</h2>
      <div class="grid">
        <label for="spp">Sessions per project</label>
        <input id="spp" type="number" min="1" max="500" bind:value={draft.ui.sessionsPerProject} />
        <label for="sw">Width (px)</label>
        <input id="sw" type="number" min="160" max="800" step="10" bind:value={draft.ui.sidebarWidth} />
        <label for="gs">Group subfolders</label>
        <label class="check">
          <input id="gs" type="checkbox" bind:checked={draft.ui.groupSubfolders} />
          <span class="muted">Show subfolder sessions under their parent project</span>
        </label>
        <label for="gb">Group by branch</label>
        <label class="check">
          <input id="gb" type="checkbox" bind:checked={draft.ui.groupByBranch} />
          <span class="muted">Group each project's sessions by git branch</span>
        </label>
        <label for="pk">Screen peek</label>
        <div>
          <select id="pk" bind:value={draft.ui.peek}>
            <option value="all">Every row</option>
            <option value="waiting">Waiting agents only</option>
            <option value="off">Off</option>
          </select>
          <span class="muted hint">The last line on a tab's screen, under its name in the Open view</span>
        </div>
        <label for="og">Output graph</label>
        <label class="check">
          <input id="og" type="checkbox" bind:checked={draft.ui.outputGraph} />
          <span class="muted">Five minutes of output beside each row in the Open view</span>
        </label>
        <label for="ta">Task box</label>
        <div class="check">
          <select id="ta" aria-label="Task box agent" bind:value={draft.ui.taskAgent}>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          <span class="muted">in</span>
          <select aria-label="Task box project" bind:value={draft.ui.taskProject}>
            <option value="">This tab's project</option>
            {#each projects as p (p.key)}<option value={p.key}>{p.name}</option>{/each}
          </select>
        </div>
      </div>

      <h2 id="s-agents">Agents</h2>
      <div class="agents">
        <span></span><span class="col">Claude</span><span class="col">Codex</span>
        <label for="cc">Command</label>
        <input id="cc" bind:value={draft.claude.command} />
        <input aria-label="Codex command" bind:value={draft.codex.command} />
        <label for="ra">Resume arguments<span class="muted hint">One per line; <code>{'{session}'}</code> is the session id</span></label>
        <textarea id="ra" bind:value={resumeArgs}></textarea>
        <textarea aria-label="Codex resume arguments" bind:value={codexResumeArgs}></textarea>
        <label for="la">Launch arguments<span class="muted hint">Every new and resumed session, e.g. <code>--model</code></span></label>
        <textarea id="la" bind:value={claudeArgs}></textarea>
        <textarea aria-label="Codex launch arguments" bind:value={codexArgs}></textarea>
        <label for="ca">Chat arguments<span class="muted hint">Added for chats. Codex keeps its MCP servers; only its commands are read-only. <code>""</code> is an empty argument</span></label>
        <textarea id="ca" bind:value={claudeChatArgs}></textarea>
        <textarea aria-label="Codex chat arguments" bind:value={codexChatArgs}></textarea>
      </div>
      <div class="grid folders">
        <label for="pd">Claude projects</label>
        <input
          id="pd"
          class="wide"
          placeholder="%USERPROFILE%\.claude\projects"
          value={draft.projects.claudeProjectsDir ?? ''}
          oninput={(e) => draft && (draft.projects.claudeProjectsDir = e.currentTarget.value)}
        />
        <label for="codex-home">Codex home</label>
        <input id="codex-home" class="wide" placeholder="CODEX_HOME or ~/.codex" bind:value={draft.codex.homeDir} />
        <label for="sd">Scratch directory</label>
        <input
          id="sd"
          class="wide"
          placeholder="scratch, in ATC's config directory"
          value={draft.claude.scratchDir ?? ''}
          oninput={(e) => draft && (draft.claude.scratchDir = e.currentTarget.value)}
        />
      </div>
      <p class="muted hint">Empty fields use the default. A new projects directory is watched after a restart.</p>

      <h2 id="s-names">Names</h2>
      {#each Object.keys(draft.projects.names) as path (path)}
        <div class="rename-row">
          <input class="wide" bind:value={draft.projects.names[path]} aria-label="Name for {path}" />
          <span class="muted path" title={path}>{path}</span>
          <button class="btn" onclick={() => removeName('names', path)} title="Use the folder name again">Reset</button>
        </div>
      {/each}
      {#each Object.keys(draft.projects.sessionNames) as id (id)}
        <div class="rename-row">
          <input class="wide" bind:value={draft.projects.sessionNames[id]} aria-label="Name for session {id}" />
          <span class="muted path" title={id}>{sessionLabel(id)}</span>
          <button class="btn" onclick={() => removeName('sessionNames', id)} title="Use the agent's title again">Reset</button>
        </div>
      {/each}
      {#if !Object.keys(draft.projects.names).length && !Object.keys(draft.projects.sessionNames).length}
        <p class="muted">None yet. Right-click a project or session in the sidebar and choose Rename.</p>
      {/if}

      <h2 id="s-advanced">Advanced</h2>
      <div class="grid">
        <label for="sh">Shell</label>
        <div>
          <select id="sh" bind:value={draft.terminal.shell}>
            <option value="auto">PowerShell 7 if installed</option>
            <option value="pwsh">PowerShell 7</option>
            <option value="powershell">Windows PowerShell</option>
          </select>
          <span class="muted hint">For new tabs. Agents start with PowerShell commands, so only PowerShell is offered.</span>
        </div>
        <label for="lp">PowerShell profile</label>
        <label class="check">
          <input id="lp" type="checkbox" bind:checked={draft.terminal.loadProfile} />
          <span class="muted">Load it in new tabs. Off starts tabs faster, without your prompt and aliases</span>
        </label>
        <label for="gpu">GPU-drawn tabs</label>
        <div>
          <input id="gpu" type="number" min="0" max="12" bind:value={draft.terminal.gpuTabs} />
          <span class="muted hint">The most recent tabs drawn with WebGL. 0 draws every tab in software, for remote desktop or GPU trouble</span>
        </div>
        <label for="nti">New tab opens in</label>
        <div>
          <select id="nti" bind:value={draft.ui.newTabIn}>
            <option value="home">Your home folder</option>
            <option value="project">This tab's project</option>
          </select>
        </div>
        <label for="cfc">Confirm close</label>
        <label class="check">
          <input id="cfc" type="checkbox" bind:checked={draft.ui.confirmClose} />
          <span class="muted">Ask before closing a tab with a program running in it</span>
        </label>
        <label for="tst">In-app notes</label>
        <div class="check">
          <input id="tst" type="checkbox" bind:checked={draft.ui.toasts} />
          <span class="muted">When a background tab finishes while ATC is focused, for</span>
          <input type="number" min="1" max="60" aria-label="Seconds a note stays" bind:value={draft.ui.toastSeconds} />
          <span class="muted">seconds</span>
        </div>
        <label for="lr">Claude limits every</label>
        <div class="check">
          <input id="lr" type="number" min="15" max="3600" step="15" bind:value={draft.ui.limitsRefreshSec} />
          <span class="muted">seconds</span>
        </div>
        <label for="cr">Codex limits every</label>
        <div class="check">
          <input id="cr" type="number" min="15" max="3600" step="15" bind:value={draft.ui.codexRefreshSec} />
          <span class="muted">seconds. Each read starts a Codex process</span>
        </div>
      </div>

    </SectionNav>
  {/if}
</Page>

<style>
  .agents {
    display: grid;
    grid-template-columns: 190px minmax(0, 220px) minmax(0, 220px);
    align-items: start;
    gap: 10px 16px;
  }
  .agents label {
    display: flex;
    flex-direction: column;
    padding-top: 5px;
  }
  .col {
    color: var(--fg-dim);
    font-size: 12px;
    font-weight: 600;
  }
  .folders {
    margin-top: 10px;
  }
  .saved {
    animation: atc-fade var(--enter) var(--ease-out);
  }
  textarea {
    min-height: 52px;
    box-sizing: border-box;
    resize: vertical;
  }
  select + .hint {
    margin-left: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    align-items: center;
    gap: 10px 16px;
  }
  label {
    color: var(--fg);
    font-size: 12px;
  }
  input[type='number'] {
    width: 90px;
  }
  input[type='range'] {
    width: 180px;
    padding: 0;
    border: none;
    accent-color: var(--accent);
  }
  .speed {
    min-width: 4ch;
    color: var(--fg-bright);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wide {
    width: 100%;
    max-width: 460px;
    box-sizing: border-box;
  }
  .hint {
    margin-top: 3px;
    font-size: 11px;
  }
  select {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  .swatches {
    display: inline-flex;
    margin-left: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 4px;
    vertical-align: -3px;
  }
  .swatch {
    width: 14px;
    height: 14px;
  }
  code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-chrome);
  }
  .rename-row {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
