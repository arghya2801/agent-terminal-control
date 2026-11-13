<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import Icon from '../lib/Icon.svelte';
  import { matchCommands, typedCommand, type Sigil } from './commands';
  import type { Command } from '../../sidecar/protocol';

  let { text = $bindable(''), name, history, hints = true, sigils, commands, ready = true, working, waiting = false, disabled, onSend, onSendNow, onStop, onFiles, onInput, toolbar }: {
    /** What is in the box; a rewind puts its prompt back here. */
    text?: string;
    name: string;
    /** Earlier prompts, oldest first: Up and Down walk them from an empty box. */
    history: string[];
    /** The `/ $ @` hint in the placeholder; off while the empty state already shows it. */
    hints?: boolean;
    /** What opens the menu: `/` for commands, and `$` for Codex's skills. */
    sigils: Sigil[];
    commands: Command[];
    /** False until the session has listed its commands. */
    ready?: boolean;
    working: boolean;
    /** A card above waits for an answer. */
    waiting?: boolean;
    disabled: boolean;
    /** Images as data URLs. */
    onSend: (text: string, images: string[]) => void;
    /** Ctrl+X Ctrl+S: the queued message, and what is in the box, go now. */
    onSendNow?: (text: string, images: string[]) => void;
    onStop: () => void;
    /** Typing `@` asks for the project's files, which arrive as `@path` commands. */
    onFiles?: () => void;
    /** Any typing, so a dormant session can start its CLI before the message is sent. */
    onInput?: () => void;
    /** Model, mode and status, along the bottom of the box. */
    toolbar?: Snippet;
  } = $props();

  const uid = $props.id();
  let caret = $state(0);
  let box = $state<HTMLTextAreaElement>();
  let pick = $state(0);
  let dismissed = $state(false);
  let chordAt = 0;

  const typed = $derived(typedCommand(text, caret, sigils));
  const atFiles = $derived(typed?.sigil === '@');
  $effect(() => {
    if (atFiles) untrack(() => onFiles?.());
  });
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

  function send(now = false) {
    if ((!now && !text.trim() && !images.length) || disabled) return;
    (now && onSendNow ? onSendNow : onSend)(text.trim(), images.map((i) => i.url));
    text = '';
    images = [];
    problem = '';
    recall = -1;
  }

  /** Pictures to send with the message: pasted, or dropped on the box. */
  /** One copy each, as a data URL: it shows here and in the chat, and is sent as is. */
  let images = $state<{ url: string; name: string }[]>([]);
  let problem = $state('');
  let dragging = $state(false);
  let picker = $state<HTMLInputElement>();
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
      images = [...images, { url, name: f.name || 'pasted image' }];
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
    if (!text) recall = -1;
    const next = recall + by;
    // An edited recall is a draft now: arrows move in it rather than replace it.
    const shown = recall === -1 ? '' : history[history.length - 1 - recall];
    if (next < -1 || next >= history.length || text !== shown) return false;
    recall = next;
    text = next === -1 ? '' : history[history.length - 1 - next];
    queueMicrotask(() => box?.setSelectionRange(text.length, text.length));
    return true;
  }

  function onKey(e: KeyboardEvent) {
    // An input method is composing: Enter and the arrows are its, not ours.
    if (e.isComposing) return;
    // Ctrl+X then Ctrl+S, as in Claude Code: force send. Ctrl+X still cuts a selection.
    const ctrl = e.ctrlKey && !e.shiftKey && !e.altKey;
    if (ctrl && e.key.toLowerCase() === 'x' && working && box?.selectionStart === box?.selectionEnd) {
      e.preventDefault();
      chordAt = Date.now();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 's' && Date.now() - chordAt < 2000) {
      e.preventDefault();
      chordAt = 0;
      send(true);
      return;
    }
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
    if (!e.altKey && ((e.key === 'ArrowUp' && firstLine && step(1)) || (e.key === 'ArrowDown' && lastLine && step(-1)))) {
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
  class:waiting
  class:dragging
  ondragover={(e) => hasFiles(e) && !disabled && (e.preventDefault(), (dragging = true))}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  {#if images.length || problem}
    <div class="attachments">
      <!-- Unkeyed: the same image pasted twice has the same URL. -->
      {#each images as img, i}
        <figure>
          <img src={img.url} alt={img.name} />
          <button class="remove" onclick={() => (images = images.filter((_, j) => j !== i))} aria-label="Remove {img.name}" title="Remove">×</button>
        </figure>
      {/each}
      {#if problem}<span class="problem">{problem}</span>{/if}
    </div>
  {/if}
  {#if menu.length}
    <div class="menu">
      <ul role="listbox" id="{uid}-menu" aria-label="Commands and skills">
        {#each menu as c, i (c.name)}
          {@const at = typed ? c.name.toLowerCase().indexOf(typed.query, 1) : -1}
          {@const source = /^\(([^)]+)\)\s*/.exec(c.description)}
          <li role="option" id="{uid}-{i}" aria-selected={i === pick}>
            <button class:on={i === pick} onmousedown={(e) => e.preventDefault()} onclick={() => choose(c)} onmouseenter={() => (pick = i)} title={c.description}>
              <span class="cmd">{#if at > 0 && typed?.query}{c.name.slice(0, at)}<mark>{c.name.slice(at, at + typed.query.length)}</mark>{c.name.slice(at + typed.query.length)}{:else}{label(c)}{/if}</span>
              {#if c.hint}<span class="hint">{c.hint}</span>{/if}
              <span class="desc">{source ? c.description.slice(source[0].length) : c.description}</span>
              {#if source}<span class="source">{source[1]}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <div class="keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Tab</kbd> or <kbd>Enter</kbd> to pick <kbd>Esc</kbd> to close</div>
    </div>
  {:else if typed && typed.sigil !== '@' && !dismissed}
    <div class="menu" role="status">
      <div class="keys note">{ready ? `Nothing matches ${typed.sigil}${typed.query}` : `Loading ${typed.sigil === '$' ? 'skills' : 'commands and skills'}...`}</div>
    </div>
  {/if}
  <textarea
    bind:this={box}
    bind:value={text}
    oninput={() => (track(), onInput?.())}
    onkeyup={track}
    onclick={track}
    onkeydown={onKey}
    onpaste={onPaste}
    rows="1"
    {disabled}
    placeholder={disabled ? 'Resume the session to keep going' : waiting ? `Answer ${name} above, or type a message to send after this turn` : working ? 'Enter queues a message for when this turn ends; Ctrl+X Ctrl+S sends it now' : !hints ? `Ask ${name}` : sigils.includes('$') ? `Ask ${name}: / for commands, $ for skills, @ for files` : `Ask ${name}: / for commands and skills, @ for files`}
    aria-label="Message {name}"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={menu.length > 0}
    aria-controls="{uid}-menu"
    aria-activedescendant={menu.length ? `${uid}-${pick}` : undefined}
  ></textarea>
  <div class="bar">
    <button class="attach" onclick={() => picker?.click()} {disabled} title="Attach images (or paste or drop them)" aria-label="Attach images"><Icon name="image" size={15} /></button>
    <input type="file" accept={TYPES.join(',')} multiple hidden bind:this={picker} onchange={(e) => (void attach([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ''))} />
    {@render toolbar?.()}
    <div class="grow"></div>
    <div class="ends">
    {#if working}<button class="round stop" onclick={onStop} title="Stop the turn (Esc)" aria-label="Stop"><Icon name="stop" size={13} /></button>{/if}
    <button class="round send" onclick={() => send()} disabled={disabled || (!text.trim() && !images.length)} title={working ? 'Queue: sends when this turn ends (Enter)' : 'Send (Enter)'} aria-label={working ? 'Queue' : 'Send'}><Icon name="up" size={16} /></button>
    </div>
  </div>
</div>

<style>
  .console {
    position: relative;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.22), 0 1px 2px rgb(0 0 0 / 0.12);
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
    font-size: calc(12px * var(--chat-scale, 1));
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
    font-size: calc(12px * var(--chat-scale, 1));
    color: var(--danger);
  }
  .console.waiting:focus-within {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
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
    max-height: 30vh;
    resize: none;
    font: inherit;
    font-size: calc(14px * var(--chat-scale, 1));
    line-height: 1.5;
    color: var(--fg-bright);
    background: transparent;
    border: none;
    padding: 14px 16px 4px;
  }
  textarea:focus-visible {
    outline: none;
  }
  textarea::placeholder {
    color: color-mix(in srgb, var(--fg-faint) 65%, transparent);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 8px 8px;
    font-size: calc(12px * var(--chat-scale, 1));
    color: var(--fg-faint);
  }
  .grow {
    flex: 1;
  }
  /* Stop and send wrap as one, at the end. */
  .ends {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .attach {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .attach:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .round {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out);
  }
  .send {
    background: var(--accent);
    color: var(--on-accent);
  }
  .send:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, var(--fg-bright));
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
  .attach:focus-visible,
  .round:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 1px;
  }
  .menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    z-index: 2;
  }
  .menu ul {
    margin: 0;
    padding: 4px;
    list-style: none;
    /* Whole rows: eight of them, 34px each, plus the padding. */
    max-height: calc(8 * 34px + 8px);
    overflow-x: hidden;
    overflow-y: auto;
  }
  mark {
    background: none;
    color: var(--accent);
  }
  .source {
    flex: none;
    margin-left: auto;
    padding-left: 8px;
    font-size: calc(11px * var(--chat-scale, 1));
    color: var(--fg-faint);
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    gap: 1.2ch;
    align-items: baseline;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    align-items: center;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 7px 12px;
    border-top: 1px solid var(--border);
    font-size: calc(11.5px * var(--chat-scale, 1));
    color: var(--fg-faint);
  }
  .note {
    border-top: none;
  }
  kbd {
    font: inherit;
    padding: 0 4px;
    min-width: 10px;
    text-align: center;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    color: var(--fg-dim);
  }
  kbd + kbd {
    margin-left: -1px;
  }
  .keys kbd:not(:first-child) {
    margin-left: 6px;
  }
  .keys kbd + kbd {
    margin-left: 2px;
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
