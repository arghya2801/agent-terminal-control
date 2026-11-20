<script lang="ts">
  import Tokens from '../agent/Tokens.svelte';
  import { appState } from './stores.svelte';

  let { value = $bindable(''), lang = null }: { value: string; lang?: string | null } = $props();
  let back: HTMLPreElement;
</script>

<div
  class="editor"
  style:--mono={appState.settings?.terminal.fontFamily}
  style:--mono-size="{Math.max(11, (appState.settings?.terminal.fontSize ?? 13) - 1)}px"
>
  <pre bind:this={back} aria-hidden="true"><Tokens text={value} {lang} />{'\n'}</pre>
  <textarea bind:value spellcheck="false" onscroll={(e) => { back.scrollTop = e.currentTarget.scrollTop; back.scrollLeft = e.currentTarget.scrollLeft; }}></textarea>
</div>

<style>
  .editor {
    position: relative;
    flex: 1 0 100%;
    height: 24em;
    max-height: 60vh;
    resize: vertical;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }
  .editor pre,
  .editor textarea {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 8px 10px;
    border: 0;
    overflow: auto;
    overflow-y: scroll;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
    font-family: var(--mono);
    font-size: var(--mono-size);
    line-height: 1.55;
    letter-spacing: normal;
  }
  .editor pre {
    pointer-events: none;
    color: var(--fg);
    scrollbar-color: transparent transparent;
  }
  .editor textarea {
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: var(--fg);
  }
  .editor textarea::selection {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .editor textarea:focus-visible {
    outline: none;
  }
  .editor:focus-within {
    border-color: var(--accent);
  }
</style>
