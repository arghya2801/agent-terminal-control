export type AgentProvider = 'claude' | 'codex';

/** Mirrors the Go types in src-tauri/src/pty. Keep the two in sync by hand. */

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
  /** `pwsh` or `powershell` to prefer that one; anything else prefers pwsh. */
  shell?: string;
  noProfile?: boolean;
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
  /** The scratch or chats directory, listed in the Scratch view rather than with projects. */
  kind?: 'scratch' | 'chats';
}

/** What the tab bar and the Open view show for a tab. */
export interface TabSummary {
  key: TabKey;
  provider: AgentProvider | null;
  title: string;
  exited: boolean;
  attention: boolean;
  /** Claude's or Codex's state; null for a plain shell. */
  activity: 'working' | 'idle' | 'interrupted' | null;
  projectKey: string | null;
  /** When the tab entered its current state. */
  since: number;
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
    /** Which list the sidebar shows. Unknown values read as sessions. */
    sidebarView: string;
    /** `on`, `off`, or anything else to follow Windows' "Show animations". */
    animations: string;
    /** Multiplies animation speed: 2 is twice as fast, 0.5 half. */
    animationSpeed: number;
    /** When the 5-hour limit resets, beside the usage chip. */
    usageResetTime: boolean;
    /** Tabs across the top as well as in the sidebar's Open view. */
    showTabBar: boolean;
    /** Which Open view rows show the last line on their screen. */
    peek: 'all' | 'waiting' | 'off';
    outputGraph: boolean;
    /** What the task box starts with: its agent, and a project key or '' for the focused tab's. */
    taskAgent: AgentProvider;
    taskProject: string;
    /** Where Ctrl+Shift+T opens a shell: the home folder, or the focused tab's project. */
    newTabIn: 'home' | 'project';
    /** Ask before closing a tab with something running in it. */
    confirmClose: boolean;
    /** In-app notes when a background tab finishes while ATC has focus. */
    toasts: boolean;
    toastSeconds: number;
    limitsRefreshSec: number;
    codexRefreshSec: number;
  };
  terminal: TerminalSettings;
  /** `args` go on every launch; `chatArgs` on chats too, so they cannot change anything. */
  codex: { command: string; args: string[]; chatArgs: string[]; resumeArgs: string[]; homeDir: string | null };
  claude: { command: string; args: string[]; chatArgs: string[]; resumeArgs: string[]; scratchDir: string | null };
}


export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: 'bar' | 'block' | 'underline';
  cursorBlink: boolean;
  lineHeight: number;
  /** `auto`, `pwsh` or `powershell`. */
  shell: string;
  loadProfile: boolean;
  /** Tabs drawn with WebGL at once; 0 draws every tab in software. */
  gpuTabs: number;
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
