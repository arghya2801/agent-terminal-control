/**
 * Agent sessions, one per agent tab. A session opens in the sidecar when App opens its tab
 * and closes with the tab. Its state is everything the sidecar has said, run through
 * `apply`; the manager hears only what the tab list shows.
 */
import { agentClose, agentOpen, agentSend, Channel } from '../lib/ipc';
import { countOutput, getTab, onClosed, queuePrompt, setAgentHooks, setAgentState } from '../terminal/manager';
import { apply, emptyState, peek, type AgentState } from './apply';
import type { AgentEvent, Answer } from '../../sidecar/protocol';
import type { AgentProvider, TabKey } from '../types';

export const agents = $state<Record<string, AgentState>>({});

interface Live {
  id: string | null;
  provider: AgentProvider;
  channel: Channel<AgentEvent>;
  /** Sent once the session is ready: a task from the task box, or Reply before then. */
  queued: string[];
}
const live = new Map<TabKey, Live>();

export async function startAgent(key: TabKey, provider: AgentProvider, cwd: string, o: { session?: string | null; chat?: boolean; task?: string } = {}) {
  if (live.has(key)) return;
  agents[key] = emptyState();
  const channel = new Channel<AgentEvent>();
  const l: Live = { id: null, provider, channel, queued: o.task ? [o.task] : [] };
  live.set(key, l);
  channel.onmessage = (ev) => receive(key, ev);
  try {
    l.id = await agentOpen(provider, cwd, o.session ?? null, !!o.chat, channel);
  } catch (e) {
    receive(key, { t: 'exit', message: String(e instanceof Error ? e.message : e) });
  }
}

function receive(key: TabKey, ev: AgentEvent) {
  const s = agents[key];
  const l = live.get(key);
  if (!s || !l) return;
  apply(s, ev);
  switch (ev.t) {
    case 'delta':
    case 'output':
      countOutput(key, ev.text.length);
      break;
    case 'ready':
      setAgentState(key, { activity: s.working ? 'working' : 'idle' });
      for (const text of l.queued.splice(0)) send(key, text);
      break;
    case 'session':
      setAgentState(key, { session: `${l.provider}:${ev.id}` });
      break;
    case 'working':
      setAgentState(key, { activity: ev.on ? 'working' : 'idle' });
      break;
    case 'request':
      setAgentState(key, { waiting: true });
      break;
    case 'resolved':
      if (s.working && !s.requests.length) setAgentState(key, { activity: 'working' });
      break;
    case 'exit':
      setAgentState(key, { exited: true, activity: null });
      l.channel.dispose();
      break;
  }
}

const op = (key: TabKey, o: Record<string, unknown>) => {
  const id = live.get(key)?.id;
  if (id) void agentSend(id, o).catch((e) => receive(key, { t: 'error', message: String(e?.message ?? e) }));
};

/** A message sent while the agent works waits for the turn to end: the SDK's streaming input
 *  drops one sent mid-turn. The manager's queue sends it when the tab goes idle. */
export function send(key: TabKey, text: string) {
  const l = live.get(key);
  if (!l || !text.trim()) return;
  if (!l.id || !agents[key]?.ready) l.queued.push(text);
  else if (agents[key].working) {
    const had = getTab(key)?.queued;
    queuePrompt(key, had ? `${had}\n\n${text}` : text);
  } else op(key, { op: 'send', text });
}
export const interrupt = (key: TabKey) => op(key, { op: 'interrupt' });
export const answer = (key: TabKey, request: string, a: Answer) => op(key, { op: 'answer', request, answer: a });
export const setMode = (key: TabKey, mode: string) => op(key, { op: 'mode', mode });
export const setModel = (key: TabKey, model: string) => op(key, { op: 'model', model });

onClosed((key) => {
  const l = live.get(key);
  if (!l) return;
  live.delete(key);
  l.channel.dispose();
  if (l.id) void agentClose(l.id).catch(() => {});
  delete agents[key];
});

setAgentHooks({ peek: (key) => (agents[key] ? peek(agents[key]) : []), send });
