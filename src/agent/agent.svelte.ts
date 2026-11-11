/**
 * Agent sessions, one per agent tab. A session opens in the sidecar when App opens its tab
 * and closes with the tab. Its state is everything the sidecar has said, run through
 * `apply`; the manager hears only what the tab list shows.
 */
import { agentCatalog, agentClose, agentOpen, agentSend, Channel } from '../lib/ipc';
import { countOutput, getTab, markDone, onClosed, queuePrompt, setAgentHooks, setAgentState } from '../terminal/manager';
import { apply, emptyState, withSentImages, type AgentState } from './apply';
import type { AgentEvent, Answer, ChatItem, Command, Image, Model } from '../../sidecar/protocol';
import type { AgentProvider, TabKey } from '../types';
import { accountFor, appState } from '../lib/stores.svelte';

/** Each tab's session. `fresh`: nothing sent and nothing resumed, so the tab can still
 *  move to the other provider. `account`: the Claude account it runs as (#252). */
export const agents = $state<Record<string, AgentState & { fresh: boolean; account: string }>>({});

type Start = { session?: string | null; chat?: boolean; task?: string; model?: string; effort?: string; account?: string };
interface Live {
  id: string | null;
  provider: AgentProvider;
  cwd: string;
  chat: boolean;
  channel: Channel<AgentEvent>;
  /** Sent once the session is ready: a task from the task box, or Reply before then. */
  queued: { text: string; images: string[] }[];
  /** The images of the manager's queued message, as data URLs, sent when it is. */
  images: string[];
  /** Images of sent messages, for their echoes, which carry only a count. */
  sent: string[][];
}
const live = new Map<TabKey, Live>();

const stored = <T,>(k: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const PREFS = 'atc.agentPrefs';
const prefs = stored<Partial<Record<AgentProvider, { model?: string; effort?: string | null }>>>(PREFS, {});
function remember(provider: AgentProvider | undefined, p: { model?: string; effort?: string | null }) {
  if (!provider) return;
  prefs[provider] = { ...prefs[provider], ...p };
  store(PREFS, prefs);
}

const COMMANDS = 'atc.commands';
const commandCache = stored<Record<string, Command[]>>(COMMANDS, {});
export const knownCommands = (provider: AgentProvider, cwd: string) => commandCache[`${provider}:${cwd}`] ?? commandCache[provider] ?? [];

export async function startAgent(key: TabKey, provider: AgentProvider, cwd: string, o: Start = {}) {
  if (live.has(key)) return;
  if (!o.session) o = { ...o, model: o.model ?? prefs[provider]?.model, effort: o.effort ?? prefs[provider]?.effort ?? undefined };
  if (provider === 'claude') o = { ...o, account: o.account ?? accountFor(o.session ? `claude:${o.session}` : null) };
  agents[key] = { ...emptyState(), fresh: !o.session && !o.task, account: o.account ?? '' };
  const channel = new Channel<AgentEvent>();
  const l: Live = { id: null, provider, cwd, chat: !!o.chat, channel, queued: o.task ? [{ text: o.task, images: [] }] : [], images: [], sent: [] };
  live.set(key, l);
  channel.onmessage = (ev) => receive(key, ev);
  try {
    const id = await agentOpen(provider, cwd, o, channel);
    // The tab closed while its session opened, which then has no tab to close it.
    if (live.get(key) !== l) return void agentClose(id).catch(() => {});
    l.id = id;
  } catch (e) {
    receive(key, { t: 'exit', message: String(e instanceof Error ? e.message : e) });
  }
}

/** Move a fresh tab to the other provider: its empty session ends and one of the other
 *  CLI starts in its place, on `model`. A conversation cannot change provider. */
export function switchProvider(key: TabKey, provider: AgentProvider, model: string) {
  const l = live.get(key);
  if (!l || !agents[key]?.fresh || l.provider === provider) return;
  end(key);
  remember(provider, { model, effort: null });
  setAgentState(key, { provider });
  void startAgent(key, provider, l.cwd, { chat: l.chat, model });
}

const catalogs = new Map<AgentProvider, Promise<Model[]>>();
/** A provider's models, for a fresh tab's picker; asked once. */
export function catalog(provider: AgentProvider): Promise<Model[]> {
  let asked = catalogs.get(provider);
  if (!asked) {
    asked = new Promise<Model[]>((resolve, reject) => {
      const channel = new Channel<AgentEvent>();
      channel.onmessage = (ev) => {
        if (ev.t === 'catalog') resolve(ev.models);
        else if (ev.t === 'exit') {
          channel.dispose();
          reject(new Error(ev.message ?? 'No models'));
        }
      };
      agentCatalog(provider, channel).catch(reject);
    });
    asked.catch(() => catalogs.delete(provider));
    catalogs.set(provider, asked);
  }
  return asked;
}

function receive(key: TabKey, ev: AgentEvent) {
  const s = agents[key];
  const l = live.get(key);
  if (!s || !l) return;
  apply(s, withSentImages(ev, s.items, l.sent));
  switch (ev.t) {
    case 'delta':
    case 'output':
      countOutput(key, ev.text.length);
      break;
    case 'ready':
    case 'dormant':
      if (ev.t === 'ready') store(COMMANDS, Object.assign(commandCache, { [`${l.provider}:${l.cwd}`]: ev.commands, [l.provider]: ev.commands }));
      setAgentState(key, { activity: s.working ? 'working' : 'idle' });
      for (const q of l.queued.splice(0)) send(key, q.text, q.images);
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
      if (!s.requests.length) setAgentState(key, s.working ? { activity: 'working' } : { waiting: false });
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
/** `images` are data URLs; the one copy the page keeps is the one it shows. */
export function send(key: TabKey, text: string, images: string[] = []) {
  const l = live.get(key);
  if (!l || (!text.trim() && !images.length)) return;
  if (agents[key]) agents[key].fresh = false;
  if (getTab(key)?.done) markDone(key, false);
  if (!l.id || !(agents[key]?.ready || agents[key]?.dormant)) l.queued.push({ text, images });
  else if (agents[key].working) {
    const had = getTab(key)?.queued;
    // Nothing queued means any held images were cancelled with their text.
    l.images = [...(had ? l.images : []), ...images];
    queuePrompt(key, had ? `${had}\n\n${text}` : text || IMAGES);
  } else {
    if (images.length) l.sent.push(images);
    op(key, { op: 'send', text, images: images.map(toImage) });
  }
}
const toImage = (url: string): Image => ({ mediaType: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) });
/** Images held with the queued message. */
export const queuedImages = (key: TabKey) => live.get(key)?.images.length ?? 0;
/** The queue's text for a message of only images, which the queue shows. */
const IMAGES = '(images)';
export const interrupt = (key: TabKey) => op(key, { op: 'interrupt' });
export const stopTask = (key: TabKey, task: string) => op(key, { op: 'stopTask', task });
export const answer = (key: TabKey, request: string, a: Answer) => op(key, { op: 'answer', request, answer: a });
export const setMode = (key: TabKey, mode: string) => op(key, { op: 'mode', mode });
export const setModel = (key: TabKey, model: string) => (remember(live.get(key)?.provider, { model }), op(key, { op: 'model', model }));
export const setEffort = (key: TabKey, effort: string | null) => (remember(live.get(key)?.provider, { effort }), op(key, { op: 'effort', effort }));
export const listFiles = (key: TabKey) => op(key, { op: 'files' });
/** Start a dormant session's CLI ahead of the first message, so its commands are listed. */
export function wake(key: TabKey) {
  if (!agents[key]?.dormant) return;
  // Once is enough: Codex sends nothing that clears it, and its tab is already ready.
  agents[key].dormant = false;
  op(key, { op: 'wake' });
}
/** Back to before `prompt`: Claude by its id, Codex by the turn it started. */
export const rewind = (key: TabKey, prompt: ChatItem) => op(key, { op: 'rewind', to: prompt.turn ?? prompt.id });

/** Start a stopped tab's session again from its transcript. */
/** Run the tab as another Claude account: its CLI restarts and resumes the conversation. */
export function switchAccount(key: TabKey, account: string) {
  const l = live.get(key);
  const s = agents[key];
  if (!l || !s || s.account === account) return;
  if (s.working) return void (appState.error = 'Stop the turn first, then switch accounts');
  const session = s.sessionId;
  end(key);
  setAgentState(key, { exited: false, account });
  void startAgent(key, l.provider, l.cwd, { chat: l.chat, session, account, model: session ? undefined : s.model ?? undefined });
}

export function resume(key: TabKey) {
  const l = live.get(key);
  const session = agents[key]?.sessionId;
  const account = agents[key]?.account;
  if (!l || !agents[key]?.exited) return;
  end(key);
  setAgentState(key, { exited: false });
  void startAgent(key, l.provider, l.cwd, { chat: l.chat, session, account });
}

/** Sessions still closing, by tab, until their CLI has exited. */
const closing = new Map<TabKey, Promise<void>>();
/** Settles once the tab's last session has let go of its transcript, so a terminal can
 *  resume it without two writers (#227). */
export const whenClosed = (key: TabKey) => closing.get(key) ?? Promise.resolve();

/** End a tab's session; it stays on disk to resume. */
function end(key: TabKey) {
  const l = live.get(key);
  if (!l) return;
  live.delete(key);
  l.channel.dispose();
  if (l.id) {
    const done: Promise<void> = agentClose(l.id).catch(() => {}).finally(() => closing.get(key) === done && closing.delete(key));
    closing.set(key, done);
  }
  delete agents[key];
}
onClosed(end);

setAgentHooks({
  send: (key, text) => {
    const images = live.get(key)?.images.splice(0) ?? [];
    send(key, images.length && text === IMAGES ? '' : text, images);
  },
});
