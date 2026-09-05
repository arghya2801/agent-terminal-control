/** Mirrors the Rust types in src-tauri/src/pty. Keep the two in sync by hand. */

/** Output and lifecycle share one ordered stream — see PtyEvent in session.rs. */
export type PtyEvent =
  | { t: 'o'; d: string }
  | { t: 'x'; code: number | null }
  | { t: 'e'; msg: string };

export interface SpawnOpts {
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
export type TabKey = `project:${string}` | `session:${string}` | `plain:${string}`;

export interface Dims {
  cols: number;
  rows: number;
}

export type LabelSource = 'aiTitle' | 'slug' | 'firstMessage' | 'uuid';

export interface SessionMeta {
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
  };
  ui: {
    sidebarWidth: number;
    sidebarOpen: boolean;
    sessionsPerProject: number;
    zoom: number;
  };
  terminal: TerminalSettings;
  claude: { command: string; resumeArgs: string[] };
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
}
