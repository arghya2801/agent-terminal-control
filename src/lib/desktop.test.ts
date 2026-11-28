// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

let receive: (ev: { name: string; data: unknown }) => void = () => {};
const off = vi.fn();
vi.mock('@wailsio/runtime', () => ({ Events: { On: (_: string, cb: typeof receive) => ((receive = cb), off) } }));
const IndexScan = vi.fn();
vi.mock('../bindings/atc/app', () => ({ IndexScan: (...a: unknown[]) => IndexScan(...a) }));

const { Channel, listen } = await import('./desktop');
const { indexRefresh } = await import('./ipc');

afterEach(() => { off.mockClear(); IndexScan.mockReset(); });
describe('Wails desktop transport', () => {
  it('passes command arguments to the bound method and returns its result', async () => {
    IndexScan.mockResolvedValue({ projects: [] });
    expect(await indexRefresh(true)).toEqual({ projects: [] });
    expect(IndexScan).toHaveBeenCalledWith(true);
  });
  it('rejects with the Go error message, as Wails v2 did', async () => {
    IndexScan.mockRejectedValue(new Error('no such folder'));
    await expect(indexRefresh()).rejects.toBe('no such folder');
  });
  it('delivers event payloads and unsubscribes', async () => {
    const callback = vi.fn(); const dispose = await listen('index://updated', callback);
    receive({ name: 'index://updated', data: { sessionCount: 13 } }); expect(callback).toHaveBeenCalledWith({ sessionCount: 13 });
    dispose(); expect(off).toHaveBeenCalledOnce();
  });
  it('preserves terminal event order and removes listeners at exit', () => {
    const channel = new Channel(); const callback = vi.fn(); channel.onmessage = callback; channel.attach();
    receive({ name: channel.name, data: { t: 'o', d: '世界' } }); receive({ name: channel.name, data: { t: 'x', code: 0 } }); channel.dispose();
    expect(callback.mock.calls.map(([x]) => x.t)).toEqual(['o', 'x']); expect(off).toHaveBeenCalledOnce();
  });
});
