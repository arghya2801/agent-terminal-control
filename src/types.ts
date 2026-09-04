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
  shell?: string | null;
  args?: string[] | null;
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

export interface ShellInfo {
  path: string;
  args: string[];
  label: string;
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
