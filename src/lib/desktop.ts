/** Desktop transport. The UI talks to Go through one typed command boundary. */
import type { PtyEvent } from '../types';

type Runtime = { EventsOn(name: string, callback: (value: unknown) => void): () => void };
type Host = Window & { go?: { main: { App: { Invoke(command: string, args: Record<string, unknown>): Promise<unknown> } } }; runtime?: Runtime };
const host = () => window as Host;

export function invoke<T = void>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const api = host().go?.main.App;
  if (!api) return Promise.reject(new Error('The ATC desktop backend is unavailable. Start the app with Wails.'));
  return api.Invoke(command, args) as Promise<T>;
}

export class Channel<T> {
  readonly name = `pty:${crypto.randomUUID()}`;
  onmessage: (message: T) => void = () => {};
  private unsubscribe?: () => void;
  attach() {
    const runtime = host().runtime;
    if (!runtime) throw new Error('Wails event runtime unavailable');
    this.unsubscribe = runtime.EventsOn(this.name, (message) => {
      this.onmessage(message as T);
      if ((message as PtyEvent).t === 'x') this.dispose();
    });
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = undefined; }
}

export async function listen<T>(name: string, callback: (payload: T) => void): Promise<() => void> {
  const runtime = host().runtime;
  if (!runtime) throw new Error('Wails event runtime unavailable');
  return runtime.EventsOn(name, (payload) => callback(payload as T));
}
/** Wails v2 cannot change WebView zoom at runtime, so the UI zooms with CSS. */
export function setZoom(zoom: number) {
  document.documentElement.style.zoom = String(zoom);
  window.dispatchEvent(new Event('resize'));
}
export function save(options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null> {
  return invoke('save_dialog', { options });
}
export function isPermissionGranted(): Promise<boolean> { return invoke('notification_permission'); }
export async function requestPermission(): Promise<string> { return await invoke<boolean>('notification_request') ? 'granted' : 'denied'; }
export function sendNotification(options: { title: string; body: string }): void { void invoke('notification_send', { options }).catch(console.warn); }

/** A full page reload replaces its shells; HMR within the same document keeps them. */
export async function frontendReady(): Promise<void> {
 const page = window as Window & { __atcPageID?: string };
 page.__atcPageID ??= crypto.randomUUID();
 await invoke("frontend_ready", { pageID: page.__atcPageID });
}
