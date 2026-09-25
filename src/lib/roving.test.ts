import { describe, expect, it, vi } from 'vitest';
import { listKeys, moveIndex } from './roving';

describe('moveIndex', () => {
  it('moves and clamps', () => {
    expect(moveIndex('ArrowDown', -1, 3)).toBe(0);
    expect(moveIndex('ArrowDown', 2, 3)).toBe(2);
    expect(moveIndex('End', 0, 3)).toBe(2);
    expect(moveIndex('x', 0, 3)).toBeNull();
    expect(moveIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('listKeys', () => {
  function list() {
    const el = document.createElement('div');
    el.innerHTML = `
      <div data-group><button data-row aria-expanded="true" id="p">p</button>
        <button data-row id="s1">s1</button><button data-row disabled id="off">x</button><button data-row id="s2">s2</button></div>`;
    document.body.replaceChildren(el);
    return el;
  }
  const key = (target: HTMLElement, k: string, shiftKey = false) => {
    const e = new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true });
    Object.defineProperty(e, 'target', { value: target });
    return e;
  };
  const leave = () => ({ up: vi.fn(), escape: vi.fn() });

  it('skips disabled rows, leaves upward from the top, goes up to the project', () => {
    const el = list();
    const [p, s1, s2] = ['p', 's1', 's2'].map((id) => document.getElementById(id)!);
    const l = leave();
    listKeys(key(s1, 'ArrowDown'), el, l);
    expect(document.activeElement).toBe(s2);
    listKeys(key(s2, 'ArrowLeft'), el, l);
    expect(document.activeElement).toBe(p);
    listKeys(key(p, 'ArrowUp'), el, l);
    expect(l.up).toHaveBeenCalled();
  });

  it('collapses an expanded project on Left and opens the menu on Shift+F10', () => {
    const el = list();
    const p = document.getElementById('p')!;
    const click = vi.fn();
    const menu = vi.fn();
    p.addEventListener('click', click);
    p.addEventListener('contextmenu', menu);
    listKeys(key(p, 'ArrowRight'), el, leave());
    expect(click).not.toHaveBeenCalled();
    listKeys(key(p, 'ArrowLeft'), el, leave());
    expect(click).toHaveBeenCalledOnce();
    listKeys(key(p, 'F10', true), el, leave());
    expect(menu).toHaveBeenCalledOnce();
  });
});
