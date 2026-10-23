/** Typed wrappers over the Go command surface. One place for every command name. */

import { Channel, invoke } from './desktop';
import type { AgentProvider, CostRow, IndexSnapshot, PtyEvent, Settings, SpawnOpts, StatsSnapshot } from '../types';

export { Channel };

export function ptySpawn(opts: SpawnOpts, onEvent: Channel<PtyEvent>): Promise<string> {
  onEvent.attach();
  return invoke<string>('pty_spawn', { opts, channel: onEvent.name }).catch((error) => { onEvent.dispose(); throw error; });
}

export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

/** Tells Go the webview has parsed `bytes`, releasing backpressure. */
export function ptyAck(id: string, bytes: number): Promise<void> {
  return invoke('pty_ack', { id, bytes });
}

/** A program running under the tab's shell, or null at a bare prompt. */
export function ptyBusy(id: string): Promise<string | null> {
  return invoke('pty_busy', { id });
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

export function notesGet(): Promise<string> {
  return invoke<string>('notes_get');
}

export function notesSet(text: string): Promise<void> {
  return invoke('notes_set', { text });
}

export function openInExplorer(path: string): Promise<void> {
  return invoke('open_in_explorer', { path });
}

/** Open an http(s) link in the default browser. */
/** The latest release when it is newer than this build, or null. */
export function newerRelease(): Promise<{ version: string; url: string } | null> {
  return invoke<{ version: string; url: string } | null>('newer_release');
}

export function openUrl(url: string): Promise<void> {
  return invoke('open_url', { url });
}

/** Compatibility command; Wails handles Ctrl+Shift+F12 natively in debug builds. */
export function openDevtools(): Promise<void> {
  return invoke('open_devtools');
}

/** The native folder picker; null when cancelled. */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>('folder_dialog');
}

/** The directory "Ask Claude" and chats run in; created if missing. */
export function scratchDir(): Promise<string> {
  return invoke<string>('scratch_dir');
}

/** Writes text to a path the user picked in the save dialog. */
export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke('write_text_file', { path, contents });
}

/** Opens settings.json in the user's default editor, creating it if needed. */
export function openSettingsFile(): Promise<void> {
  return invoke('open_settings_file');
}

/** Token use and list-price cost per (UTC hour, project, model), across all transcripts. */
export function usageCosts(): Promise<CostRow[]> {
  return invoke<CostRow[]>('usage_costs');
}

/** Each session's context window on its latest request, by `provider:sessionId`. */
export function usageContext(): Promise<Record<string, { used: number; window: number }>> {
  return invoke<Record<string, { used: number; window: number }>>('usage_context');
}

/** Theme files in the config directory's `themes/` folder, unvalidated. */
export function listThemes(): Promise<{ stem: string; palette: unknown }[]> {
  return invoke<{ stem: string; palette: unknown }[]>('list_themes');
}

/** Plan limits as `/usage` shows them. Shape belongs to the API, so kept loose. */
export function claudeUsage(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('claude_usage');
}

/** With `chat`, the agent starts with the chat arguments from settings: no tools for Claude, a read-only sandbox for Codex. */
export function agentCommand(provider: AgentProvider, sessionId: string | null = null, chat = false): Promise<string> {
  return invoke<string>('agent_command', { provider, sessionId, chat });
}

/** Null when the Codex CLI is not installed. */
export function codexUsage(): Promise<Record<string, unknown> | null> { return invoke('codex_usage'); }
export function codexUsageStop(): Promise<void> { return invoke('codex_usage_stop'); }
