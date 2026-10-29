import type { AgentEvent, AgentRequest, ChatItem, Command, Model, Step } from '../../sidecar/protocol';

/** Everything the chat view shows for one session, built only from sidecar events. */
export interface AgentState {
  items: ChatItem[];
  requests: AgentRequest[];
  commands: Command[];
  models: Model[];
  modes: string[];
  model: string | null;
  mode: string | null;
  /** Null is the CLI's default. */
  effort: string | null;
  sessionId: string | null;
  ready: boolean;
  working: boolean;
  /** When the current turn started, for the timer. */
  since: number;
  exited: boolean;
  /** Resumed, with no CLI running yet: sending starts one. */
  dormant: boolean;
  plan: Step[];
  /** For the `@` menu, as the last `files` answer listed them. */
  files: string[];
}

export function emptyState(): AgentState {
  return { items: [], requests: [], commands: [], models: [], modes: [], model: null, mode: null, effort: null, sessionId: null, ready: false, working: false, since: 0, exited: false, dormant: false, plan: [], files: [] };
}

let notices = 0;
/** A notice, unless it repeats the last one: a failed start reports itself as a result,
 *  then again as the exit. */
function notify(s: AgentState, text: string, error = false) {
  const last = s.items.at(-1);
  if (last?.kind === 'notice' && last.text?.includes(text.replace(/^.*?: /, ''))) return;
  s.items.push({ id: `notice-${++notices}`, kind: 'notice', text, error });
}

/** Apply one event in place. Items are matched by id, so a streamed draft, its final text
 *  and a tool's result all land on the same item. */
export function apply(s: AgentState, ev: AgentEvent, now = Date.now()) {
  const find = (id: string) => s.items.find((i) => i.id === id);
  switch (ev.t) {
    case 'ready':
      Object.assign(s, { commands: ev.commands, models: ev.models, modes: ev.modes, ready: true, dormant: false });
      if (ev.model) s.model = ev.model;
      if (ev.mode) s.mode = ev.mode;
      if (ev.effort !== undefined) s.effort = ev.effort;
      return;
    case 'session':
      s.sessionId = ev.id;
      return;
    case 'history':
      for (const e of ev.events) apply(s, e, now);
      return;
    case 'clear':
      Object.assign(s, { items: [], requests: [], plan: [] });
      return;
    case 'dormant':
      s.dormant = true;
      return;
    case 'rewound': {
      const at = s.items.findIndex((i) => i.id === ev.to);
      if (at >= 0) s.items.splice(at);
      s.requests = [];
      return;
    }
    case 'item': {
      const had = find(ev.item.id);
      if (had) Object.assign(had, ev.item);
      else if (ev.item.kind === 'notice') notify(s, ev.item.text ?? '', ev.item.error);
      else s.items.push({ ...ev.item });
      return;
    }
    case 'delta': {
      const had = find(ev.id);
      if (had) had.text = (had.text ?? '') + ev.text;
      else s.items.push({ id: ev.id, kind: ev.kind, text: ev.text, parent: ev.parent });
      return;
    }
    case 'output': {
      const had = find(ev.id);
      if (had) had.output = (had.output ?? '') + ev.text;
      return;
    }
    case 'result': {
      const had = find(ev.id);
      if (had) Object.assign(had, { output: ev.output, error: ev.error, declined: ev.declined, done: true });
      return;
    }
    case 'progress': {
      const had = find(ev.id);
      if (had) had.seconds = ev.seconds;
      return;
    }
    case 'working':
      if (ev.on && !s.working) s.since = now;
      s.working = ev.on;
      return;
    case 'request':
      s.requests.push(ev.request);
      return;
    case 'resolved':
      s.requests = s.requests.filter((r) => r.id !== ev.id);
      return;
    case 'model':
      s.model = ev.model;
      return;
    case 'mode':
      s.mode = ev.mode;
      return;
    case 'effort':
      s.effort = ev.effort;
      return;
    case 'plan':
      s.plan = ev.steps;
      return;
    case 'files':
      s.files = ev.files;
      return;
    case 'error':
      notify(s, ev.message, true);
      return;
    case 'exit':
      Object.assign(s, { exited: true, working: false, requests: [] });
      if (ev.message) notify(s, ev.message, true);
      return;
  }
}

/** The last lines of the agent's latest reply, for the Open view's peek. */
export function peek(s: AgentState): string[] {
  const last = s.items.findLast((i) => i.kind === 'assistant' && i.text);
  return (last?.text ?? '').split('\n').filter((l) => l.trim()).slice(-3);
}
