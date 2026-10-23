<script lang="ts">
  import { onMount } from 'svelte';
  import { pageZoom } from '../lib/desktop';
  import { sessionPreview } from '../lib/ipc';
  import type { SessionMeta } from '../types';

  /** A session's last turns beside the sidebar, read-only, so the right one gets resumed (#160). */
  let { session, top, left, onOpen, onClose }: {
    session: SessionMeta;
    /** Screen position of the row it belongs to. */
    top: number;
    left: number;
    onOpen: () => void;
    onClose: () => void;
  } = $props();

  let turns = $state<{ role: 'user' | 'assistant' | 'tool'; text: string }[] | null>(null);
  let error = $state<string | null>(null);
  let box: HTMLDivElement;
  const zoom = pageZoom();

  onMount(() => {
    // On the body: the sidebar would clip it, as it does any fixed child (see ContextMenu).
    document.body.append(box);
    sessionPreview(session.file).then((t) => (turns = t), (e) => (error = String(e)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpen();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!box.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  });
  $effect(() => {
    void turns;
    box?.querySelector('.turns')?.scrollTo({ top: 1e9 });
  });
</script>

<div
  class="preview"
  bind:this={box}
  role="dialog"
  aria-label="Preview of {session.label}"
  style="left: {left / zoom}px; top: {Math.max(8, Math.min(top, window.innerHeight - 420)) / zoom}px"
>
  <header>
    <b>{session.label}</b>
    <span>Enter to resume, Esc to close</span>
  </header>
  <div class="turns">
    {#if error}
      <p class="err">{error}</p>
    {:else if !turns}
      <p class="muted">Reading the transcript…</p>
    {:else if turns.length === 0}
      <p class="muted">Nothing said in this session yet.</p>
    {:else}
      {#each turns as t, i (i)}
        <div class="turn {t.role}">{t.role === 'tool' ? `Used ${t.text}` : t.text}</div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .preview {
    position: fixed;
    z-index: 40;
    display: flex;
    width: min(440px, 60vw);
    max-height: 400px;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    animation: atc-pop var(--enter) var(--ease-out);
    transform-origin: top left;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  header b {
    overflow: hidden;
    color: var(--fg-bright);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header span {
    flex: none;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .turns {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 10px 12px;
  }
  .turn {
    max-height: 9.6em;
    overflow: hidden;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .user {
    align-self: flex-end;
    max-width: 85%;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--fg-bright);
  }
  .assistant {
    color: var(--fg);
  }
  .tool {
    color: var(--fg-faint);
    font-size: 11px;
  }
  p {
    margin: 0;
  }
</style>
