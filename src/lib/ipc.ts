/**
 * Typed wrappers over the Go command surface. The calls are the bindings Wails generates
 * from App's methods (`npm run bindings`), so a renamed command or argument fails the check.
 */

import * as App from '../../wailsjs/go/main/App';
import { pty } from '../../wailsjs/go/models';
import { Channel } from './desktop';
import type { AgentProvider, CostRow, IndexSnapshot, PtyEvent, Settings, SpawnOpts, StatsSnapshot } from '../types';

export { Channel };

export function ptySpawn(opts: SpawnOpts, onEvent: Channel<PtyEvent>): Promise<string> {
  onEvent.attach();
  return App.PtySpawn(pty.Options.createFrom(opts), onEvent.name).catch((error) => { onEvent.dispose(); throw error; });
}

export function ptyWrite(id: string, data: string): Promise<void> { return App.PtyWrite(id, data); }

export function ptyResize(id: string, cols: number, rows: number): Promise<void> { return App.PtyResize(id, cols, rows); }

/** Tells Go the webview has parsed `bytes`, releasing backpressure. */
export function ptyAck(id: string, bytes: number): Promise<void> { return App.PtyAck(id, bytes); }

/** A program running under the tab's shell, or null at a bare prompt. */
export function ptyBusy(id: string): Promise<string | null> { return App.PtyBusy(id); }

export function ptyKill(id: string): Promise<void> { return App.PtyKill(id); }

export function ptyStats(id: string): Promise<StatsSnapshot> { return App.PtyStats(id); }

export function indexSnapshot(): Promise<IndexSnapshot> { return App.IndexScan(false); }

export function indexRefresh(force = false): Promise<IndexSnapshot> { return App.IndexScan(force); }

export function settingsGet(): Promise<Settings> { return App.SettingsGet() as Promise<Settings>; }

export function settingsSet(settings: Settings): Promise<void> { return App.SettingsSet(settings); }

export function notesGet(): Promise<string> { return App.NotesGet(); }

export function notesSet(text: string): Promise<void> { return App.NotesSet(text); }

export function openInExplorer(path: string): Promise<void> { return App.OpenInExplorer(path); }

/** The latest release when it is newer than this build, or null. */
export function newerRelease(): Promise<{ version: string; url: string } | null> { return App.NewerRelease(); }

/** Open an http(s) link in the default browser. */
export function openUrl(url: string): Promise<void> { return App.OpenURL(url); }

/** The native folder picker; null when cancelled. */
export function pickFolder(): Promise<string | null> { return App.FolderDialog(); }

/** The directory "Ask Claude" and chats run in; created if missing. */
export function scratchDir(): Promise<string> { return App.ScratchDir(); }

/** Writes text to a path the user picked in the save dialog. */
export function writeTextFile(path: string, contents: string): Promise<void> { return App.WriteTextFile(path, contents); }

/** Opens settings.json in the user's default editor, creating it if needed. */
export function openSettingsFile(): Promise<void> { return App.OpenSettingsFile(); }

/** Token use and list-price cost per (UTC hour, project, model), across all transcripts. */
export function usageCosts(): Promise<CostRow[]> { return App.UsageCosts(); }

/** Each session's context window on its latest request, by `provider:sessionId`. */
export function usageContext(): Promise<Record<string, { used: number; window: number }>> { return App.UsageContext(); }

/** Theme files in the config directory's `themes/` folder, unvalidated. */
export function listThemes(): Promise<{ stem: string; palette: unknown }[]> { return App.ListThemes(); }

/** Plan limits as `/usage` shows them. Shape belongs to the API, so kept loose. */
export function claudeUsage(): Promise<Record<string, unknown>> { return App.ClaudeUsage(); }

/** With `chat`, the agent starts with the chat arguments from settings: no tools for Claude, a read-only sandbox for Codex. */
export function agentCommand(provider: AgentProvider, sessionId: string | null = null, chat = false): Promise<string> { return App.AgentCommand(provider, sessionId ?? '', chat); }

/** Null when the Codex CLI is not installed. */
export function codexUsage(): Promise<Record<string, unknown> | null> { return App.CodexUsage(); }
export function codexUsageStop(): Promise<void> { return App.CodexUsageStop(); }
