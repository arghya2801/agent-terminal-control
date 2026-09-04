<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ptyStats } from '../lib/ipc';
  import type { StatsSnapshot, TabKey } from '../types';
  import { getTab } from '../terminal/manager';

  let { activeKey }: { activeKey: TabKey | null } = $props();

  let stats = $state<StatsSnapshot | null>(null);
  let prev: { bytes: number; sends: number; at: number } | null = null;
  let rates = $state({ bytesPerSec: 0, sendsPerSec: 0 });

  // Sampled rather than pushed: the point is to observe the PTY pipeline without
  // adding IPC traffic that would distort what it measures.
  const timer = setInterval(async () => {
    const tab = activeKey ? getTab(activeKey) : null;
    if (!tab?.ptyId) { stats = null; return; }
    try {
      const s = await ptyStats(tab.ptyId);
      const now = performance.now();
      if (prev) {
        const dt = (now - prev.at) / 1000;
        rates = {
          bytesPerSec: Math.round((s.bytesOut - prev.bytes) / dt),
          sendsPerSec: Math.round((s.sends - prev.sends) / dt),
        };
      }
      prev = { bytes: s.bytesOut, sends: s.sends, at: now };
      stats = s;
    } catch {
      stats = null;
    }
  }, 500);

  onDestroy(() => clearInterval(timer));

  const avgPayload = $derived(stats && stats.sends > 0 ? Math.round(stats.bytesOut / stats.sends) : 0);
  const overPct = $derived(stats && stats.sends > 0
    ? ((stats.sendsOverThreshold / stats.sends) * 100).toFixed(1)
    : '0.0');
</script>

<div class="overlay">
  <div class="title">pty · Ctrl+Shift+D</div>
  {#if stats}
    <div class="row"><span>bytes/s</span><b>{rates.bytesPerSec.toLocaleString()}</b></div>
    <div class="row"><span>sends/s</span><b>{rates.sendsPerSec}</b></div>
    <div class="row"><span>avg payload</span><b>{avgPayload} B</b></div>
    <div class="row" class:warn={Number(overPct) > 10}>
      <span>over 8192</span><b>{overPct}%</b>
    </div>
    <div class="row" class:warn={stats.inflight > 1_000_000}>
      <span>inflight</span><b>{(stats.inflight / 1024).toFixed(0)} KB</b>
    </div>
    <div class="row" class:warn={stats.pausedCount > 0}>
      <span>backpressure</span><b>{stats.pausedCount}</b>
    </div>
    <div class="row"><span>total out</span><b>{(stats.bytesOut / 1024).toFixed(0)} KB</b></div>
  {:else}
    <div class="row"><span>no live pty</span></div>
  {/if}
</div>

<style>
  .overlay {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 10;
    min-width: 190px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(13, 17, 23, 0.92);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 11px;
    color: #8b949e;
    pointer-events: none;
  }
  .title { margin-bottom: 6px; color: #539bf5; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; gap: 16px; line-height: 1.6; }
  .row b { color: #c9d1d9; font-weight: 500; }
  .row.warn b { color: #daaa3f; }
</style>
