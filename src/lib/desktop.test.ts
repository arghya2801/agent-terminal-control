import { afterEach, describe, expect, it, vi } from 'vitest';
import { Channel, invoke, listen } from './desktop';

afterEach(() => { delete (window as any).go; delete (window as any).runtime; });
describe('Wails desktop transport', () => {
  it('passes command arguments and returns host results', async () => {
    const call = vi.fn().mockResolvedValue({ projects: [] });
    (window as any).go = { main: { App: { Invoke: call } } };
    expect(await invoke('index_refresh', { force: true })).toEqual({ projects: [] });
    expect(call).toHaveBeenCalledWith('index_refresh', { force: true });
  });
  it('rejects when the backend is unavailable', async () => { await expect(invoke('settings_get')).rejects.toThrow('desktop backend'); });
  it('delivers event payloads and unsubscribes', async () => {
    let receive: (value: unknown) => void = () => {};
    const off = vi.fn();
    (window as any).runtime = { EventsOn: (_: string, cb: typeof receive) => { receive = cb; return off; } };
    const callback = vi.fn(); const dispose = await listen('index://updated', callback);
    receive({ sessionCount: 13 }); expect(callback).toHaveBeenCalledWith({ sessionCount: 13 });
    dispose(); expect(off).toHaveBeenCalledOnce();
  });
  it('preserves terminal event order and removes listeners at exit', () => {
    let receive: (value: unknown) => void = () => {};
    const off = vi.fn();
    (window as any).runtime = { EventsOn: (_: string, cb: typeof receive) => { receive = cb; return off; } };
    const channel = new Channel(); const callback = vi.fn(); channel.onmessage = callback; channel.attach();
    receive({ t: 'o', d: '世界' }); receive({ t: 'x', code: 0 }); channel.dispose();
    expect(callback.mock.calls.map(([x]) => x.t)).toEqual(['o', 'x']); expect(off).toHaveBeenCalledOnce();
  });
});
