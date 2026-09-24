export type AgentProvider = 'claude' | 'codex';

/** Mirrors the Rust types in src-tauri/src/pty. Keep the two in sync by hand. */

/** Output and lifecycle share one ordered stream — see PtyEvent in session.rs. */
export type PtyEvent =
  | { t: 'o'; d: string }
  | { t: 'x'; code: number | null }
  | { t: 'e'; msg: string };

export interface SpawnOpts {
  provider?: AgentProvider | null;
  cwd?: string | null;
  cols: number;
  rows: number;
  /** Typed into the shell after it starts, e.g. `claude --resume <uuid>`. */
  initialCommand?: string | null;
}

export interface StatsSnapshot {
  bytesOut: number;
  sends: number;
  sendsOverThreshold: number;
  inflight: number;
  pausedCount: number;
}

/**
 * Identity for tab reuse. A project tab and a session tab for the same directory are
 * deliberately distinct.
 */
export type TabKey =
  | `project:${string}`
  | `session:${string}`
  | `plain:${string}`
  | `claude:${string}`
  | `agent:${AgentProvider}:${string}`;

export interface Dims {
  cols: number;
  rows: number;
}

export type LabelSource = 'custom' | 'agentName' | 'aiTitle' | 'slug' | 'firstMessage' | 'uuid';

export interface SessionMeta {
  provider: AgentProvider;
  createdAtMs?: number | null;
  activity?: 'working' | 'idle' | 'interrupted' | null;
  activitySequence?: number;
  id: string;
  file: string;
  /** Authoritative cwd from the transcript. Null when the head budget found none. */
  cwd: string | null;
  gitBranch: string | null;
  label: string;
  labelSource: LabelSource;
  mtimeMs: number;
  size: number;
}

export interface Project {
  key: string;
  /** Null for the Unknown group, which has no usable path. */
  path: string | null;
  name: string;
  pinned: boolean;
  exists: boolean;
  lastActiveMs: number;
  sessions: SessionMeta[];
}

export interface IndexSnapshot {
  projects: Project[];
  sessionCount: number;
}

export interface Settings {
  version: number;
  projects: {
    claudeProjectsDir: string | null;
    pinned: { path: string; displayName: string | null; order: number }[];
    /** User-chosen project names, by project path. */
    names: Record<string, string>;
    /** User-chosen session labels, by session uuid. */
    sessionNames: Record<string, string>;
  };
  ui: {
    sidebarWidth: number;
    sidebarOpen: boolean;
    sessionsPerProject: number;
    zoom: number;
    notifications: boolean;
    restoreTabs: boolean;
    /** Theme name, matched case-insensitively against the installed themes. */
    theme: string;
    /** Sessions from a subfolder appear under the project containing it. */
    groupSubfolders: boolean;
    /** Sessions appear under the git branch they ran on. */
    groupByBranch: boolean;
  };
  terminal: TerminalSettings;
  codex: { command: string; resumeArgs: string[]; homeDir: string | null };
  claude: { command: string; resumeArgs: string[]; scratchDir: string | null };
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
}

/** Mirrors `CostRow` in src-tauri/src/index/cost.rs. */
export interface CostRow {
  provider: AgentProvider;
  totalTokens: number;
  reasoning: number;
  /** UTC hour, `YYYY-MM-DDTHH`. */
  hour: string;
  /** Session uuid, for the per-session breakdown. */
  sessionId: string;
  /** Empty when the transcript recorded no working directory. */
  projectKey: string;
  projectPath: string | null;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUsd: number | null;
  unpriced: boolean;
}
