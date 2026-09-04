/** Typed wrappers over the Rust command surface. One place for every command name. */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { PtyEvent, ShellInfo, SpawnOpts, StatsSnapshot } from '../types';

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

export function resolveShell(path?: string | null): Promise<ShellInfo> {
  return invoke<ShellInfo>('resolve_shell_cmd', { path: path ?? null });
}
