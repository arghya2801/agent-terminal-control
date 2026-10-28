/**
 * What Go, the sidecar and the chat view say to each other, one JSON object per line.
 * Types only: the frontend imports this file too.
 */
export type Provider = 'claude' | 'codex';

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'notice' | 'turn';
  text?: string;
  tool?: string;
  /** A tool call in one line: a command, a path, a pattern. */
  input?: string;
  /** The whole call; edits and patches as -/+ lines. */
  body?: string;
  output?: string;
  error?: boolean;
  /** The call has its result. */
  done?: boolean;
  /** Seconds a running call has taken so far. */
  seconds?: number;
  /** The Task call a subagent's item belongs to. */
  parent?: string | null;
  durationMs?: number;
  costUsd?: number;
  /** Codex: the turn a user message started, to rewind to. */
  turn?: string;
  /** Images sent with a user message, as data URLs. */
  images?: string[];
}

/** An image to send: its media type and base64 data. */
export interface Image {
  mediaType: string;
  data: string;
}

export interface Command {
  /** As typed: `/compact`, or `$skill` for a Codex skill. */
  name: string;
  description: string;
  hint?: string;
}

export interface Model {
  id: string;
  label: string;
  description?: string;
  /** The full model id an alias such as `opus` stands for. */
  resolved?: string;
  /** Reasoning effort levels the model takes, lowest first; none means it has no setting. */
  efforts?: string[];
  defaultEffort?: string;
}

export interface Question {
  id: string;
  question: string;
  header?: string;
  multi?: boolean;
  options: { label: string; description?: string }[];
}

/** Something only the user can answer: a permission, a question, a plan. */
export interface AgentRequest {
  id: string;
  kind: 'permission' | 'question' | 'plan';
  tool: string;
  input: string;
  body?: string;
  questions?: Question[];
  /** "Always allow" is on offer. */
  always?: boolean;
}

export interface Answer {
  allow: boolean;
  always?: boolean;
  /** Why not, for the agent to read. */
  message?: string;
  /** Question id -> chosen labels. */
  answers?: Record<string, string[]>;
}

export type AgentEvent =
  | { t: 'ready'; commands: Command[]; models: Model[]; model?: string; mode?: string; modes: string[]; effort?: string | null }
  | { t: 'session'; id: string }
  | { t: 'history'; events: AgentEvent[] }
  /** The conversation was cleared or rewritten; history follows if any remains. */
  | { t: 'clear' }
  | { t: 'item'; item: ChatItem }
  | { t: 'delta'; id: string; kind: 'assistant' | 'thinking'; text: string; parent?: string | null }
  | { t: 'output'; id: string; text: string }
  | { t: 'result'; id: string; output: string; error: boolean }
  | { t: 'progress'; id: string; seconds: number }
  | { t: 'working'; on: boolean }
  | { t: 'request'; request: AgentRequest }
  | { t: 'resolved'; id: string }
  | { t: 'model'; model: string }
  | { t: 'mode'; mode: string }
  /** Null is the CLI's default. */
  | { t: 'effort'; effort: string | null }
  /** A provider's models, answering `catalog`, before any session of it runs. */
  | { t: 'catalog'; models: Model[] }
  | { t: 'error'; message: string }
  | { t: 'exit'; message?: string };

export type AgentOp =
  | { op: 'open'; id: string; provider: Provider; cwd: string; resume?: string; exe: string; args: string[]; env?: Record<string, string>; model?: string; effort?: string }
  | { op: 'catalog'; id: string; provider: Provider; cwd: string; exe: string; args: string[]; env?: Record<string, string> }
  | { op: 'effort'; id: string; effort: string | null }
  | { op: 'send'; id: string; text: string; images?: Image[] }
  | { op: 'interrupt'; id: string }
  | { op: 'answer'; id: string; request: string; answer: Answer }
  | { op: 'mode'; id: string; mode: string }
  | { op: 'model'; id: string; model: string }
  | { op: 'close'; id: string };
