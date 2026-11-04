/**
 * Typed wrappers over the Go command surface. The calls are the bindings Wails generates
 * from App's methods (`npm run bindings`), so a renamed command or argument fails the check.
 */

import * as App from '../../wailsjs/go/main/App';
import { pty } from '../../wailsjs/go/models';
import { Channel } from './desktop';
import type { AgentProvider, CostRow, IndexSnapshot, PtyEvent, Settings, SpawnOpts, StatsSnapshot } from '../types';
import type { AgentEvent } from '../../sidecar/protocol';

export { Channel };

export function ptySpawn(opts: SpawnOpts, onEvent: Channel<PtyEvent>): Promise<string> {
  onEvent.attach();
  return App.PtySpawn(pty.Options.createFrom(opts), onEvent.name).catch((error) => { onEvent.dispose(); throw error; });
}

export function ptyWrite(id: string, data: string): Promise<void> { return App.PtyWrite(id, data); }

/** Start a Claude or Codex session in the sidecar, resuming `session` when set. */
export function agentOpen(provider: AgentProvider, cwd: string, o: { session?: string | null; chat?: boolean; model?: string; effort?: string }, events: Channel<AgentEvent>): Promise<string> {
  events.attach();
  return App.AgentOpen(provider, cwd, o.session ?? '', !!o.chat, o.model ?? '', o.effort ?? '', events.name).catch((error) => { events.dispose(); throw error; });
}

/** A provider's models on `events`, then an exit, without starting a session. */
export function agentCatalog(provider: AgentProvider, events: Channel<AgentEvent>): Promise<void> {
  events.attach();
  return App.AgentCatalog(provider, events.name).catch((error) => { events.dispose(); throw error; });
}

export function agentSend(id: string, op: Record<string, unknown>): Promise<void> { return App.AgentSend(id, op); }

export function agentClose(id: string): Promise<void> { return App.AgentClose(id); }

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

export interface GitChanges { files: number; insertions: number; deletions: number; untracked: number }

/** What changed in a working tree since HEAD; null outside git. */
export function gitChanges(dir: string): Promise<GitChanges | null> { return App.GitChanges(dir); }

/** The last turns of a session's transcript, read without starting it. */
export function sessionPreview(file: string): Promise<{ role: 'user' | 'assistant' | 'tool'; text: string }[]> { return App.SessionPreview(file) as never; }

/** Sessions whose prompts or replies contain `query`, newest first, one hit each. */
export function searchTranscripts(query: string): Promise<{ session: string; role: string; snippet: string; time: string }[]> { return App.SearchTranscripts(query); }

/** A short name for a session from the model chosen in settings. */
export function suggestSessionName(file: string): Promise<string> { return App.SuggestSessionName(file); }

/** Every plan-limit reading of the last 8 days, oldest first, as each endpoint returned it. */
export function limitsHistory(): Promise<{ t: number; provider: 'claude' | 'codex'; body: Record<string, unknown> }[]> { return App.LimitsHistory() as never; }

/** Null when the Codex CLI is not installed. */
export function codexUsage(): Promise<Record<string, unknown> | null> { return App.CodexUsage(); }
export function codexUsageStop(): Promise<void> { return App.CodexUsageStop(); }
