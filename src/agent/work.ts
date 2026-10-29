/**
 * How a turn's work reads at a glance, after t3code's work log: runs of tool calls fold
 * into one sentence ("Read 3 files and ran 2 commands"), paths show relative to the
 * workspace, and the status line says what the agent is doing now.
 */
import type { ChatItem } from '../../sidecar/protocol';

export type Action = 'read' | 'edit' | 'command' | 'code-search' | 'web' | 'agent' | 'tasks' | 'other';

export function toolAction(tool = ''): Action {
  if (/^(Read|NotebookRead|view_image)$/.test(tool)) return 'read';
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/.test(tool)) return 'edit';
  if (/^(Bash|BashOutput|KillShell|Shell|exec|PowerShell)$/.test(tool)) return 'command';
  if (/^(Grep|Glob|LS)$/.test(tool)) return 'code-search';
  if (/^(WebSearch|WebFetch)$/.test(tool)) return 'web';
  if (/^(Task|Agent)$/.test(tool)) return 'agent';
  if (/^(TaskCreate|TaskUpdate|TaskList|TaskGet|TodoWrite)$/.test(tool)) return 'tasks';
  return 'other';
}

/** Calls the user acts on or reads as conversation; never folded into a group. */
const STANDALONE = /^(AskUserQuestion|ExitPlanMode|TodoWrite|Question)$/;

/** What a call did, then what it is doing: "Ran npm test", "Running npm test". */
const VERBS: Record<string, [string, string]> = {
  Write: ['Wrote', 'Writing'],
  Grep: ['Searched for', 'Searching for'],
  Glob: ['Looked for', 'Looking for'],
  LS: ['Listed', 'Listing'],
  WebFetch: ['Fetched', 'Fetching'],
  WebSearch: ['Searched the web for', 'Searching the web for'],
  AskUserQuestion: ['Asked', 'Asking'],
  Question: ['Asked', 'Asking'],
  ExitPlanMode: ['Proposed a plan', 'Proposing a plan'],
  TaskCreate: ['Added a task', 'Adding a task'],
  TaskUpdate: ['Updated task', 'Updating task'],
  TodoWrite: ['Updated the task list', 'Updating the task list'],
  Skill: ['Used the skill', 'Using the skill'],
  ToolSearch: ['Loaded tools', 'Loading tools'],
};
const ACTION_VERBS: Partial<Record<Action, [string, string]>> = {
  read: ['Read', 'Reading'],
  edit: ['Edited', 'Editing'],
  command: ['Ran', 'Running'],
  'code-search': ['Searched', 'Searching'],
  web: ['Searched the web', 'Searching the web'],
  agent: ['Delegated', 'Delegating'],
};
export function toolVerb(tool = '', running = false): string {
  const pair = VERBS[tool] ?? ACTION_VERBS[toolAction(tool)];
  return pair ? pair[running ? 1 : 0] : tool.replace(/^mcp__/, '').replace(/__/g, ' / ');
}

const norm = (p: string) => p.replace(/^\/([a-z])\//i, '$1:/').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
/** A shell call as it was meant: without the `pwsh -Command '...'` wrapper Codex adds, or
 *  a leading `cd` into the workspace. */
export function cleanCommand(command: string, cwd: string | null): string {
  let out = command.trim();
  const wrapped = /^(?:"[^"]*?(?:pwsh|powershell|bash|cmd)(?:\.exe)?"|\S*?(?:pwsh|powershell|bash|cmd)(?:\.exe)?)\s+(?:-\w+\s+)*?-(?:Command|c)\s+(['"])([\s\S]*)\1$/i.exec(out);
  if (wrapped) out = wrapped[1] === "'" ? wrapped[2].replaceAll("''", "'") : wrapped[2];
  const cd = /^cd\s+(?:"([^"]+)"|(\S+))\s*(?:&&|;)\s*/.exec(out);
  if (cd && cwd && norm(cd[1] ?? cd[2]) === norm(cwd)) out = out.slice(cd[0].length);
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PHRASES: Record<Action, (n: number) => string> = {
  read: (n) => `read ${plural(n, 'file')}`,
  edit: (n) => `changed ${plural(n, 'file')}`,
  command: (n) => `ran ${plural(n, 'command')}`,
  'code-search': (n) => `searched the code ${plural(n, 'time')}`,
  web: (n) => `searched the web ${plural(n, 'time')}`,
  agent: (n) => `ran ${plural(n, 'subagent')}`,
  tasks: () => 'updated the task list',
  other: (n) => `used ${plural(n, 'tool')}`,
};

/** One sentence for a run of calls, in the order their kinds first appear. Edits count
 *  distinct files, so three edits to one file read "changed 1 file". */
export function summarize(items: ChatItem[]): string {
  const counts = new Map<Action, Set<string> | number>();
  for (const it of items) {
    const a = toolAction(it.tool);
    if (a === 'edit') {
      const files = (counts.get(a) as Set<string>) ?? new Set<string>();
      for (const f of (it.input ?? '').split(', ')) files.add(f);
      counts.set(a, files);
    } else counts.set(a, ((counts.get(a) as number) ?? 0) + 1);
  }
  const parts = [...counts].map(([a, c]) => PHRASES[a](typeof c === 'number' ? c : c.size));
  const sentence = parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export type Block = { kind: 'step'; item: ChatItem } | { kind: 'group'; id: string; items: ChatItem[] };

/** A turn's steps as blocks: two or more tool calls in a row, from the same agent, become
 *  one group; everything else stays a step. */
export function blocks(steps: ChatItem[]): Block[] {
  const out: Block[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length > 1) out.push({ kind: 'group', id: run[0].id, items: run });
    else if (run.length) out.push({ kind: 'step', item: run[0] });
    run = [];
  };
  for (const it of steps) {
    const groupable = it.kind === 'tool' && !STANDALONE.test(it.tool ?? '');
    if (groupable && (!run.length || run[0].parent === it.parent)) run.push(it);
    else {
      flush();
      if (groupable) run.push(it);
      else out.push({ kind: 'step', item: it });
    }
  }
  flush();
  return out;
}

/** `text` with the workspace path taken off any path inside it, either slash. */
export function relativePaths(text: string, cwd: string | null): string {
  if (!cwd || !text) return text;
  const pattern = cwd.replace(/[\\/]+$/, '').split(/[\\/]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
  return text.replace(new RegExp(`${pattern}[\\\\/]`, 'gi'), '');
}

/** What the agent is doing now, from its newest step: the call it runs, its thought, or
 *  the reply it writes. */
export function activity(steps: ChatItem[], cwd: string | null): string {
  const last = steps.at(-1);
  if (!last) return 'Thinking';
  if (last.kind === 'tool' && !last.done) {
    const input = toolAction(last.tool) === 'command' ? cleanCommand(last.input ?? '', cwd) : relativePaths(last.input ?? '', cwd);
    return `${toolVerb(last.tool, true)} ${input}`.trim();
  }
  if (last.kind === 'thinking') return thoughtLine(last.text ?? '') || 'Thinking';
  if (last.kind === 'assistant') return 'Writing';
  return 'Working';
}

/** A thought's bold heading, or else its first sentence, as plain text. */
export function thoughtLine(markdown: string): string {
  const heading = /^\s*\*\*([^*\r\n]+)\*\*/.exec(markdown)?.[1];
  const text = (heading ?? markdown).replace(/`+|\*\*|~~|^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  if (heading) return text;
  const end = /[.?!](?=\s|$)/.exec(text);
  return (end ? text.slice(0, end.index + 1) : text).slice(0, 140);
}
