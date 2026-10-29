<script lang="ts">
  import type { Snippet } from 'svelte';
  import { matchCommands, typedCommand, type Sigil } from './commands';
  import type { Command, Image } from '../../sidecar/protocol';

  let { text = $bindable(''), name, history, sigils, commands, working, disabled, onSend, onStop, toolbar }: {
    /** What is in the box; a rewind puts its prompt back here. */
    text?: string;
    name: string;
    /** Earlier prompts, oldest first: Up and Down walk them from an empty box. */
    history: string[];
    /** What opens the menu: `/` for commands, and `$` for Codex's skills. */
    sigils: Sigil[];
    commands: Command[];
    working: boolean;
    disabled: boolean;
    onSend: (text: string, images: Image[]) => void;
    onStop: () => void;
    /** Model, mode and status, along the bottom of the box. */
    toolbar?: Snippet;
  } = $props();

  let caret = $state(0);
  let box = $state<HTMLTextAreaElement>();
  let pick = $state(0);
  let dismissed = $state(false);

  const typed = $derived(typedCommand(text, caret, sigils));
  const menu = $derived(typed && !dismissed ? matchCommands(commands, typed.query, typed.sigil) : []);
  const label = (c: Command) => c.name;
  $effect(() => {
    void menu.length;
    pick = 0;
  });

  function choose(c: Command) {
    if (!typed || !box) return;
    const insert = label(c) + ' ';
    text = text.slice(0, typed.start) + insert + text.slice(caret);
    const at = typed.start + insert.length;
    queueMicrotask(() => box?.setSelectionRange(at, at));
    caret = at;
    box.focus();
  }

  function send() {
    if ((!text.trim() && !images.length) || disabled) return;
    onSend(text.trim(), images.map(({ mediaType, data }) => ({ mediaType, data })));
    text = '';
    images = [];
    problem = '';
    recall = -1;
  }

  /** Pictures to send with the message: pasted, or dropped on the box. */
  let images = $state<(Image & { url: string; name: string })[]>([]);
  let problem = $state('');
  let dragging = $state(false);
  // What both CLIs' models take, and the API's size limit for one image.
  const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX = 5 * 1024 * 1024;
  async function attach(files: File[]) {
    problem = '';
    for (const f of files) {
      if (!TYPES.includes(f.type)) {
        problem = `${f.name || 'That file'} is not a PNG, JPEG, GIF or WebP image`;
        continue;
      }
      if (f.size > MAX) {
        problem = `${f.name || 'That image'} is over 5 MB`;
        continue;
      }
      const url = await new Promise<string>((done) => {
        const r = new FileReader();
        r.onload = () => done(String(r.result));
        r.readAsDataURL(f);
      });
      images = [...images, { mediaType: f.type, data: url.slice(url.indexOf(',') + 1), url, name: f.name || 'pasted image' }];
    }
  }
  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  }
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  function onDrop(e: DragEvent) {
    dragging = false;
    if (!hasFiles(e)) return;
    e.preventDefault();
    void attach([...(e.dataTransfer?.files ?? [])]);
  }

  /** Which earlier prompt the box shows, counting back from the newest; -1 is none. */
  let recall = $state(-1);
  function step(by: 1 | -1): boolean {
    const next = recall + by;
    if (next < -1 || next >= history.length || (recall === -1 && text)) return false;
    recall = next;
    text = next === -1 ? '' : history[history.length - 1 - next];
    queueMicrotask(() => box?.setSelectionRange(text.length, text.length));
    return true;
  }

  function onKey(e: KeyboardEvent) {
    if (menu.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pick = (pick + (e.key === 'ArrowDown' ? 1 : menu.length - 1)) % menu.length;
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        choose(menu[pick]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissed = true;
        return;
      }
    }
    // Up from the first line, Down from the last, so moving inside a long prompt still works.
    const firstLine = !text.slice(0, box?.selectionStart ?? 0).includes('\n');
    const lastLine = !text.slice(box?.selectionEnd ?? 0).includes('\n');
    if ((e.key === 'ArrowUp' && firstLine && step(1)) || (e.key === 'ArrowDown' && lastLine && step(-1))) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && working) {
      e.preventDefault();
      onStop();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }
  const track = () => {
    caret = box?.selectionStart ?? 0;
    if (!typed) dismissed = false;
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (a drop target; the box itself takes input) -->
<div
  class="console"
  class:disabled
  class:dragging
  ondragover={(e) => hasFiles(e) && !disabled && (e.preventDefault(), (dragging = true))}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  {#if images.length || problem}
    <div class="attachments">
      {#each images as img, i (img.url)}
        <figure>
          <img src={img.url} alt={img.name} />
          <button class="remove" onclick={() => (images = images.filter((_, j) => j !== i))} aria-label="Remove {img.name}" title="Remove">×</button>
        </figure>
      {/each}
      {#if problem}<span class="problem">{problem}</span>{/if}
    </div>
  {/if}
  {#if menu.length}
    <ul class="menu" role="listbox" aria-label="Commands and skills">
      {#each menu as c, i (c.name)}
        <li role="option" aria-selected={i === pick}>
          <button class:on={i === pick} onmousedown={(e) => { e.preventDefault(); choose(c); }} onmouseenter={() => (pick = i)}>
            <span class="cmd">{label(c)}</span>
            {#if c.hint}<span class="hint">{c.hint}</span>{/if}
            <span class="desc">{c.description}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <textarea
    bind:this={box}
    bind:value={text}
    oninput={track}
    onkeyup={track}
    onclick={track}
    onkeydown={onKey}
    onpaste={onPaste}
    rows="1"
    {disabled}
    placeholder={disabled ? `${name} has stopped` : sigils.includes('$') ? `Ask ${name}: / for commands, $ for skills` : `Ask ${name}, or type / for commands and skills`}
    aria-label="Message {name}"
  ></textarea>
  <div class="bar">
    {@render toolbar?.()}
    <div class="grow"></div>
    {#if working}<button class="stop" onclick={onStop} title="Stop the turn (Esc)">Stop</button>{/if}
    <button class="send" onclick={send} disabled={disabled || (!text.trim() && !images.length)} title="Send (Enter)">Send</button>
  </div>
</div>

<style>
  .console {
    position: relative;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
    transition: border-color var(--fast) var(--ease-out);
  }
  .console.dragging {
    border-color: var(--accent);
    border-style: dashed;
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 0;
  }
  figure {
    position: relative;
    margin: 0;
  }
  figure img {
    display: block;
    height: 56px;
    max-width: 120px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    color: var(--fg-bright);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 50%;
    cursor: pointer;
  }
  .remove:hover {
    border-color: var(--danger);
    color: var(--danger);
  }
  .problem {
    font-size: 12px;
    color: var(--danger);
  }
  .console:focus-within {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }
  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    field-sizing: content;
    min-height: 2.6em;
    max-height: 40vh;
    resize: none;
    font: inherit;
    font-size: 14px;
    line-height: 1.5;
    color: var(--fg-bright);
    background: transparent;
    border: none;
    padding: 12px 14px 4px;
  }
  textarea:focus-visible {
    outline: none;
  }
  textarea::placeholder {
    color: var(--fg-faint);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 8px 10px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .grow {
    flex: 1;
  }
  .send,
  .stop {
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    border-radius: 8px;
    padding: 5px 14px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .send {
    background: var(--accent-strong);
    color: var(--on-accent);
  }
  .send:disabled {
    background: var(--bg-surface);
    color: var(--fg-faint);
    cursor: default;
  }
  .stop {
    background: transparent;
    color: var(--fg);
    border-color: var(--border);
  }
  .stop:hover {
    border-color: var(--danger);
    color: var(--danger);
  }
  .send:focus-visible,
  .stop:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  .menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
    max-height: 20em;
    overflow-x: hidden;
    overflow-y: auto;
    z-index: 2;
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    gap: 1.2ch;
    align-items: baseline;
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu button.on {
    background: var(--selection);
  }
  .cmd {
    font-family: var(--mono);
    font-size: var(--mono-size);
    color: var(--fg-bright);
  }
  .hint {
    font-family: var(--mono);
    font-size: var(--mono-size);
    color: var(--fg-faint);
    max-width: 24ch;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: none;
  }
  .desc {
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
