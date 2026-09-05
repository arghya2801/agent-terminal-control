/** Typed wrappers over the Rust command surface. One place for every command name. */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { IndexSnapshot, PtyEvent, Settings, SpawnOpts, StatsSnapshot } from '../types';

export { Channel };

export function ptySpawn(opts: SpawnOpts, onEvent: Channel<PtyEvent>): Promise<string> {
  return invoke<string>('pty_spawn', { opts, onEvent });
}

export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

/** Tells Rust the webview has parsed `bytes`, releasing backpressure. */
export function ptyAck(id: string, bytes: number): Promise<void> {
  return invoke('pty_ack', { id, bytes });
}

export function ptyKill(id: string): Promise<void> {
  return invoke('pty_kill', { id });
}

export function ptyStats(id: string): Promise<StatsSnapshot> {
  return invoke<StatsSnapshot>('pty_stats', { id });
}

export function indexSnapshot(): Promise<IndexSnapshot> {
  return invoke<IndexSnapshot>('index_snapshot');
}

export function indexRefresh(force = false): Promise<IndexSnapshot> {
  return invoke<IndexSnapshot>('index_refresh', { force });
}

export function settingsGet(): Promise<Settings> {
  return invoke<Settings>('settings_get');
}

export function settingsSet(settings: Settings): Promise<void> {
  return invoke('settings_set', { settings });
}

export function openInExplorer(path: string): Promise<void> {
  return invoke('open_in_explorer', { path });
}

/** Devtools, re-added under our own chord after WebView2's F12 was disabled. */
export function openDevtools(): Promise<void> {
  return invoke('open_devtools');
}

/** Opens settings.json in the user's default editor, creating it if needed. */
export function openSettingsFile(): Promise<void> {
  return invoke('open_settings_file');
}
