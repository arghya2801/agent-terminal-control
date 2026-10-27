<script lang="ts">
  import { matchCommands, typedCommand } from './commands';
  import type { Command } from '../../sidecar/protocol';

  let { name, sigil, commands, working, disabled, onSend, onStop }: {
    name: string;
    /** How the agent spells a command: `/compact` for Claude, `$skill` for Codex. */
    sigil: '/' | '$';
    commands: Command[];
    working: boolean;
    disabled: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
  } = $props();

  let text = $state('');
  let caret = $state(0);
  let box = $state<HTMLTextAreaElement>();
  let pick = $state(0);
  let dismissed = $state(false);

  const typed = $derived(typedCommand(text, caret, sigil));
  const menu = $derived(typed && !dismissed ? matchCommands(commands, typed.query) : []);
  const label = (c: Command) => (sigil === '/' ? '/' : '') + c.name;
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
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    text = '';
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

<div class="composer">
  {#if menu.length}
    <ul class="menu" role="listbox" aria-label="Commands and skills">
      {#each menu as c, i (c.name)}
        <li role="option" aria-selected={i === pick}>
          <button class:on={i === pick} onmousedown={(e) => { e.preventDefault(); choose(c); }}>
            <span class="cmd">{label(c)}</span>
            {#if c.hint && sigil === '/'}<span class="hint">{c.hint}</span>{/if}
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
    rows="1"
    {disabled}
    placeholder={disabled ? `${name} has stopped` : `Message ${name}, or ${sigil} for ${sigil === '/' ? 'commands and skills' : 'skills'}`}
    aria-label="Message {name}"
  ></textarea>
  {#if working}<button class="btn" onclick={onStop} title="Stop the turn (Esc)">Stop</button>{/if}
  <button class="btn primary" onclick={send} disabled={disabled || !text.trim()}>Send</button>
</div>

<style>
  .composer {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  textarea {
    flex: 1;
    field-sizing: content;
    min-height: 1.5em;
    max-height: 40vh;
    resize: none;
    font-family: var(--mono);
    font-size: var(--mono-size);
    line-height: 1.5;
    color: var(--fg-bright);
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 7px 9px;
  }
  textarea:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 4px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow-pop);
    max-height: 18em;
    overflow-x: hidden;
    overflow-y: auto;
    z-index: 2;
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    gap: 1ch;
    align-items: baseline;
    width: 100%;
    padding: 4px 8px;
    border-radius: 4px;
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
  .btn {
    font: inherit;
    color: var(--fg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .btn:focus-visible {
    outline: 1px solid var(--accent);
  }
  .btn.primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: var(--on-accent);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
