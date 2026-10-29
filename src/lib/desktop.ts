/** Desktop transport: Wails events, window chrome, and the dialogs and notifications. */
import * as App from '../../wailsjs/go/main/App';
import type { PtyEvent } from '../types';

type Runtime = { EventsOn(name: string, callback: (value: unknown) => void): () => void; WindowSetLightTheme(): void; WindowSetDarkTheme(): void };
const host = () => window as Window & { runtime?: Runtime };

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
/** Light or dark window chrome, so the Mica backdrop is tinted to match the theme. */
export function setWindowTheme(light: boolean) {
  const runtime = host().runtime;
  if (light) runtime?.WindowSetLightTheme();
  else runtime?.WindowSetDarkTheme();
}
/** Wails v2 cannot change WebView zoom at runtime, so the UI zooms with CSS. */
export function setZoom(zoom: number) {
  document.documentElement.style.zoom = String(zoom);
  window.dispatchEvent(new Event('resize'));
}
/**
 * The CSS zoom set above. Mouse and getBoundingClientRect positions are on-screen pixels,
 * but a fixed element's `left`/`top` are zoomed again, so they are divided by this.
 */
export function pageZoom(): number {
  return Number(document.documentElement.style.zoom) || 1;
}
export function save(options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null> {
  return App.SaveDialog(options.defaultPath, options.filters);
}
export function isPermissionGranted(): Promise<boolean> { return App.NotificationPermission(); }
export function requestPermission(): Promise<boolean> { return App.NotificationRequest(); }
export function sendNotification(options: { title: string; body: string }): void { void App.NotificationSend(options.title, options.body).catch(console.warn); }

/** A full page reload replaces its shells; HMR within the same document keeps them. */
export async function frontendReady(): Promise<void> {
 const page = window as Window & { __atcPageID?: string };
 page.__atcPageID ??= crypto.randomUUID();
 await App.FrontendReady(page.__atcPageID);
}
