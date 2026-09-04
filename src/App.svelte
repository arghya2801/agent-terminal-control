<script lang="ts">
  import { onMount } from 'svelte';
  import TabBar from './tabs/TabBar.svelte';
  import DebugOverlay from './debug/DebugOverlay.svelte';
  import {
    getActiveKey,
    listTabs,
    mount as mountTerminals,
    onChange,
    openTab,
    refit,
  } from './terminal/manager';
  import type { TabKey } from './types';

  let wrapper: HTMLDivElement;
  let tabs = $state<{ key: TabKey; title: string; exited: boolean }[]>([]);
  let activeKey = $state<TabKey | null>(null);
  let showDebug = $state(false);
  let error = $state<string | null>(null);
  let counter = 0;

  function sync() {
    tabs = listTabs().map((t) => ({ key: t.key, title: t.title, exited: t.exited }));
    activeKey = getActiveKey();
  }

  async function newTab() {
    counter += 1;
    try {
      await openTab(`plain:${counter}`, `pwsh ${counter}`, { cwd: null });
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  onMount(() => {
    const off = onChange(sync);
    mountTerminals(wrapper);
    void newTab();

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        showDebug = !showDebug;
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        void newTab();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', refit);

    return () => {
      off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', refit);
    };
  });
</script>

<div class="app">
  <aside class="sidebar">
    <!-- Projects and sessions land here in phase 2. -->
    <div class="brand">ccpg</div>
  </aside>

  <section class="main">
    <TabBar {tabs} {activeKey} onNew={newTab} />
    <div class="panes" bind:this={wrapper}></div>
    {#if showDebug}
      <DebugOverlay {activeKey} />
    {/if}
    {#if error}
      <div class="error">{error}</div>
    {/if}
  </section>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 52px 1fr;
    height: 100%;
  }
  .sidebar {
    border-right: 1px solid var(--border);
    background: var(--bg-chrome);
  }
  .brand {
    padding: 12px 0;
    color: #539bf5;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-align: center;
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
    max-width: 60%;
    padding: 8px 12px;
    border: 1px solid #e5534b;
    border-radius: 8px;
    background: rgba(35, 15, 15, 0.95);
    color: #f47067;
    font-size: 12px;
  }
</style>
