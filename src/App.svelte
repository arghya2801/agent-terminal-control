<script lang="ts">
  import { onMount } from 'svelte';
  import TabBar from './tabs/TabBar.svelte';
  import DebugOverlay from './debug/DebugOverlay.svelte';
  import Sidebar from './sidebar/Sidebar.svelte';
  import {
    appState,
    initStores,
    sidebarOpen,
    toggleSidebar,
  } from './lib/stores.svelte';
  import {
    closeTab,
    getActiveKey,
    listTabs,
    mount as mountTerminals,
    onChange,
    onChord,
    openTab,
    refit,
  } from './terminal/manager';
  import { matchChord, type Action } from './lib/keymap';
  import type { Project, SessionMeta, TabKey } from './types';

  let wrapper: HTMLDivElement;
  let tabs = $state<{ key: TabKey; title: string; exited: boolean }[]>([]);
  let activeKey = $state<TabKey | null>(null);
  let showDebug = $state(false);
  let error = $state<string | null>(null);
  let counter = 0;

  const open = $derived(sidebarOpen());
  const width = $derived(appState.settings?.ui.sidebarWidth ?? 260);

  function sync() {
    tabs = listTabs().map((t) => ({ key: t.key, title: t.title, exited: t.exited }));
    activeKey = getActiveKey();
  }

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  function newTab() {
    counter += 1;
    return guard(() => openTab(`plain:${counter}`, `pwsh ${counter}`, { cwd: null }));
  }

  function openProject(p: Project) {
    if (!p.path) return;
    return guard(() => openTab(`project:${p.key}`, p.name, { cwd: p.path }));
  }

  function openSession(p: Project, s: SessionMeta) {
    // Resume needs a real directory. A path reconstructed from the lossy folder name
    // would be wrong, so such rows are disabled rather than guessed at.
    const cwd = s.cwd ?? p.path;
    if (!cwd) return;
    const claude = appState.settings?.claude;
    const command = claude
      ? [claude.command, ...claude.resumeArgs.map((a) => a.replace('{session}', s.id))].join(' ')
      : `claude --resume ${s.id}`;
    return guard(() => openTab(`session:${s.id}`, s.label, { cwd, initialCommand: command }));
  }

  // One implementation of every chord, so a shortcut behaves identically whether focus
  // is in the terminal or the sidebar.
  function runAction(action: Action) {
    switch (action) {
      case 'toggleSidebar':
        void toggleSidebar();
        break;
      case 'newTab':
        void newTab();
        break;
      case 'toggleDebug':
        showDebug = !showDebug;
        break;
      case 'closeTab':
        if (activeKey) void closeTab(activeKey);
        break;
    }
  }

  onMount(() => {
    const off = onChange(sync);
    // Chords pressed while the terminal has focus arrive here, already consumed by
    // xterm's interceptor so they never reach the shell.
    const offChord = onChord(runAction);
    mountTerminals(wrapper);
    // Settings decide whether the sidebar is open, which decides how wide the terminal
    // pane is. Spawning a shell before that lands means the PTY starts at one width and
    // is resized moments later -- which corrupts a replayed session's scrollback.
    void (async () => {
      await initStores();
      await newTab();
    })();

    // Covers focus being anywhere outside the terminal -- the sidebar, a button.
    const onKey = (e: KeyboardEvent) => {
      const action = matchChord(e);
      if (!action) return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', refit);

    return () => {
      off();
      offChord();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', refit);
    };
  });

  // The terminal shares the wrapper's geometry, so it must re-measure once the panel
  // has finished animating -- otherwise ConPTY keeps the old column count.
  $effect(() => {
    void open;
    void width;
    const t = setTimeout(refit, 180);
    return () => clearTimeout(t);
  });
</script>

<div class="app" style="--panel: {open ? width : 0}px">
  <nav class="rail">
    <button
      class="rail-btn"
      class:on={open}
      onclick={() => toggleSidebar()}
      title="Toggle projects (Ctrl+Shift+B)"
      aria-label="Toggle projects"
    >
      ▤
    </button>
    <button
      class="rail-btn"
      onclick={() => newTab()}
      title="New shell (Ctrl+Shift+T)"
      aria-label="New shell"
    >
      +
    </button>
    <div class="spacer"></div>
    <button
      class="rail-btn small"
      class:on={showDebug}
      onclick={() => (showDebug = !showDebug)}
      title="PTY stats (Ctrl+Shift+D)"
      aria-label="Toggle debug overlay"
    >
      ◔
    </button>
  </nav>

  <aside class="panel">
    {#if open}
      <Sidebar {activeKey} onOpenProject={openProject} onOpenSession={openSession} />
    {/if}
  </aside>

  <section class="main">
    <TabBar {tabs} {activeKey} onNew={newTab} />
    <div class="panes" bind:this={wrapper}></div>
    {#if showDebug}
      <DebugOverlay {activeKey} />
    {/if}
    {#if error}
      <div class="error">
        {error}
        <button onclick={() => (error = null)} aria-label="Dismiss">×</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .app {
    display: grid;
    height: 100%;
    grid-template-columns: 44px var(--panel) 1fr;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 8px;
    border-right: 1px solid var(--border);
    background: var(--bg-chrome);
  }
  .rail-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #6e7681;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .rail-btn:hover {
    background: #1c2027;
    color: #c9d1d9;
  }
  .rail-btn.on {
    color: #539bf5;
  }
  .rail-btn.small {
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .panel {
    overflow: hidden;
  }
  .main {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  /* Every terminal pane is absolutely positioned inside this one box, so they all
     share its geometry and can be measured once. */
  .panes {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 6px 0 0 8px;
  }
  .error {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    max-width: 60%;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid #e5534b;
    border-radius: 8px;
    background: rgba(35, 15, 15, 0.95);
    color: #f47067;
    font-size: 12px;
  }
  .error button {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 15px;
    cursor: pointer;
  }
</style>
