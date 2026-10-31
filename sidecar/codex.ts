import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { clip, emit, firstLine, log, textOf } from './events.ts';
import type { AgentEvent, AgentRequest, Answer, ChatItem, Image, Model } from './protocol.ts';

type Out = (ev: AgentEvent) => void;
type Obj = Record<string, any>;
/** How a Codex process starts, from settings: the CLI, its arguments, extra environment. */
type Launch = { cwd: string; exe: string; args: string[]; env?: Record<string, string> };

/** `codex app-server` with `server` flags. npm's .cmd shims only start through a shell. */
function spawnCodex(o: Launch, server: string[]): ChildProcessWithoutNullStreams {
  const shim = /\.(cmd|bat)$/i.test(o.exe);
  return spawn(shim ? `"${o.exe}"` : o.exe, ['app-server', ...server], { cwd: o.cwd, env: { ...process.env, ...o.env }, shell: shim, windowsHide: true });
}

const toModel = (m: Obj): Model => ({
  id: m.model,
  label: m.displayName,
  description: m.description || undefined,
  efforts: (m.supportedReasoningEfforts ?? []).map((e: Obj) => e.reasoningEffort),
  defaultEffort: m.defaultReasoningEffort,
});

/** Codex's models without a thread: start the app-server, ask, stop it. */
export async function codexCatalog(o: Launch): Promise<Model[]> {
  const proc = spawnCodex(o, threadOptions(o.args).server);
  const waiting = new Map<number, (m: Obj) => void>();
  createInterface({ input: proc.stdout }).on('line', (line) => {
    try {
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    } catch {}
  });
  let next = 1;
  const call = (method: string, params: Obj = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = next++;
      waiting.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  try {
    await call('initialize', { clientInfo: { name: 'atc', title: 'ATC', version: '1' } });
    proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const r = await call('model/list', {});
    return (r.data ?? []).filter((m: Obj) => !m.hidden).map(toModel);
  } finally {
    proc.kill();
  }
}

/** The TUI flags that mean something to a thread; `-c` overrides go to the app-server. */
function threadOptions(args: string[]): { thread: Obj; server: string[] } {
  const thread: Obj = {};
  const server: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === '--sandbox' || a === '-s') thread.sandbox = next();
    else if (a === '--model' || a === '-m') thread.model = next();
    else if (a === '--ask-for-approval' || a === '-a') thread.approvalPolicy = next();
    else if (a === '-c' || a === '--config' || a === '--enable' || a === '--disable') server.push(a, next());
  }
  return { thread, server };
}

/** A Codex thread item as a chat item, or null for kinds the chat does not show. */
function itemOf(it: Obj): ChatItem | null {
  const done = it.status !== 'inProgress';
  switch (it.type) {
    case 'userMessage': {
      const content: Obj[] = it.content ?? [];
      const images = content.filter((c) => c.type === 'image' && c.url).map((c) => c.url as string);
      const text = content.map((c) => c.text ?? (c.type === 'skill' ? `$${c.name}` : '')).filter(Boolean).join(' ');
      return { id: it.id, kind: 'user', text, ...(images.length ? { images } : {}) };
    }
    case 'agentMessage':
      return { id: it.id, kind: 'assistant', text: it.text };
    case 'reasoning': {
      const text = (it.summary ?? []).join('\n\n');
      return text ? { id: it.id, kind: 'thinking', text } : null;
    }
    case 'plan':
      return { id: it.id, kind: 'assistant', text: it.text };
    case 'commandExecution':
      return { id: it.id, kind: 'tool', tool: 'Shell', input: firstLine(it.command), body: clip(it.command), output: clip(it.aggregatedOutput ?? ''), done, error: it.status === 'failed' || it.status === 'declined' || (it.exitCode ?? 0) !== 0, declined: it.status === 'declined' || undefined };
    case 'fileChange': {
      const changes: Obj[] = it.changes ?? [];
      return { id: it.id, kind: 'tool', tool: 'Edit', input: changes.map((c) => c.path).join(', '), body: clip(changes.map((c) => c.diff).join('\n')), done, error: it.status === 'failed' || it.status === 'declined', declined: it.status === 'declined' || undefined };
    }
    case 'mcpToolCall':
      return { id: it.id, kind: 'tool', tool: `${it.server}.${it.tool}`, input: firstLine(JSON.stringify(it.arguments ?? {})), body: clip(JSON.stringify(it.arguments ?? {}, null, 2)), output: clip(it.error?.message ?? textOf(it.result?.content)), done, error: !!it.error };
    case 'dynamicToolCall':
      return { id: it.id, kind: 'tool', tool: it.namespace ? `${it.namespace}.${it.tool}` : it.tool, input: firstLine(JSON.stringify(it.arguments ?? {})), done, error: it.success === false };
    case 'webSearch':
      return { id: it.id, kind: 'tool', tool: 'WebSearch', input: it.query, done: true };
    case 'contextCompaction':
      return { id: it.id, kind: 'notice', text: 'Conversation compacted' };
  }
  return null;
}

/** The approval presets of Codex's own `/approvals`: how much it may do without asking. */
const PRESETS: Record<string, { approvalPolicy: string; sandboxPolicy: Obj }> = {
  'read-only': { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly' } },
  workspace: { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } },
  'full-access': { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } },
};
const presetOf = (sandbox: Obj | undefined) =>
  sandbox?.type === 'dangerFullAccess' ? 'full-access' : sandbox?.type === 'workspaceWrite' ? 'workspace' : 'read-only';

/** Codex TUI commands the app-server has calls for. The rest of `/...` goes to the model. */
const COMMANDS = [
  { name: '/compact', description: 'Summarize the conversation to free up context' },
  { name: '/review', description: 'Review the uncommitted changes, or what you describe after it', hint: '[instructions]' },
  { name: '/undo', description: 'Undo the last turn' },
  { name: '/new', description: 'Start a new thread in this tab' },
  { name: '/rename', description: 'Name this thread', hint: '<name>' },
];

/** A thread's turns as chat history. User messages remember their turn, so the chat can
 *  rewind to one. */
function historyOf(thread: Obj): AgentEvent[] {
  const history: AgentEvent[] = [];
  for (const turn of thread.turns ?? []) {
    for (const it of turn.items ?? []) {
      const item = itemOf(it);
      if (item) history.push({ t: 'item', item: item.kind === 'user' ? { ...item, turn: turn.id } : item });
    }
    if (turn.status !== 'inProgress') history.push({ t: 'item', item: { id: `turn:${turn.id}`, kind: 'turn', durationMs: turn.durationMs ?? undefined } });
  }
  return history;
}

const readers = new Map<string, Server>();

/**
 * A `codex app-server`. Every Codex tab started the same way reads through one shared
 * server: history, models and skills, which take no lock. A tab writes through a server of
 * its own, started with its first message, because the server that loads a thread holds it
 * until that process exits, and a terminal opening the thread needs it free.
 */
class Server {
  readonly sessions = new Set<Codex>();
  /** Which tab each thread's events go to. */
  readonly threads = new Map<string, Codex>();
  private proc: ChildProcessWithoutNullStreams;
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private next = 1;
  private started: Promise<void>;
  private dead = false;
  /** Set for the shared reader. */
  private key: string;

  constructor(key: string, o: Launch, args: string[]) {
    this.key = key;
    this.proc = spawnCodex(o, args);
    this.proc.stderr.on('data', (d) => log('codex:', String(d).trimEnd()));
    this.proc.on('exit', (code) => this.end(code ? `Codex exited with ${code}` : undefined));
    this.proc.on('error', (e) => this.end(`Can't start Codex: ${e.message}`));
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch (e) {
        log('codex line:', String(e));
      }
    });
    this.started = this.send('initialize', { clientInfo: { name: 'atc', title: 'ATC', version: '1' } }).then(() => this.write({ method: 'initialized' }));
  }

  static reader(o: Launch, args: string[]): Server {
    const key = JSON.stringify([o.exe, args, o.env ?? {}]);
    let s = readers.get(key);
    if (!s) readers.set(key, (s = new Server(key, o, args)));
    return s;
  }

  write(v: Obj) {
    this.proc.stdin.write(JSON.stringify(v) + '\n');
  }

  private send(method: string, params: Obj): Promise<any> {
    const id = this.next++;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => this.calls.set(id, { resolve, reject }));
  }

  async call(method: string, params: Obj = {}): Promise<any> {
    await this.started;
    return this.send(method, params);
  }

  /** A thread's tab; with one tab, also anything that names no thread. */
  private route(p: Obj): Codex | undefined {
    const thread = p.threadId ?? p.conversationId;
    return thread ? this.threads.get(thread) : this.sessions.size === 1 ? [...this.sessions][0] : undefined;
  }

  private receive(m: Obj) {
    if (m.id !== undefined && m.method === undefined) {
      const c = this.calls.get(m.id);
      this.calls.delete(m.id);
      if (m.error) c?.reject(new Error(m.error.message ?? JSON.stringify(m.error)));
      else c?.resolve(m.result);
    } else if (m.id !== undefined) {
      const s = this.route(m.params ?? {});
      if (s) s.request(m.id, m.method, m.params ?? {});
      else this.write({ id: m.id, error: { code: -32601, message: 'No ATC tab holds this thread' } });
    } else this.route(m.params ?? {})?.notify(m.method, m.params ?? {});
  }

  /** A dead reader fails its pending calls, which stops only the tabs still starting; the
   *  next tab starts a new one. A tab's own server stopping stops the tab. */
  private end(message?: string) {
    if (this.dead) return;
    this.dead = true;
    if (readers.get(this.key) === this) readers.delete(this.key);
    for (const c of this.calls.values()) c.reject(new Error(message ?? 'Codex exited'));
    if (!this.key) for (const s of this.sessions) s.ended(message);
  }

  /** A tab closed; the server stops with its last one, which frees the threads it loaded. */
  release(s: Codex) {
    this.sessions.delete(s);
    for (const [thread, owner] of this.threads) if (owner === s) this.threads.delete(thread);
    if (this.sessions.size) return;
    if (readers.get(this.key) === this) readers.delete(this.key);
    this.proc.kill();
  }
}

/** One Codex thread through `codex app-server`, the protocol Codex's own editor
 *  extensions use. Config, approvals and session files are the CLI's own. */
export class Codex {
  private id: string;
  private o: Launch & { resume?: string };
  /** The app-server flags, and the thread settings from the TUI flags. */
  private args: string[];
  private options: Obj;
  private reader: Server;
  /** This tab's own app-server, once it has something to send. */
  private server?: Server;
  private waking?: Promise<Server>;
  private listed: Obj[] = [];
  private requests = new Map<string, { rpc: number | string; method: string; params: Obj }>();
  private n = 0;
  private thread = '';
  private turn = '';
  private chosen: string | undefined;
  private effortChosen: string | null;
  private skills = new Map<string, Obj>();
  private closing = false;
  readonly cwd: string;
  private turns: string[] = [];
  /** Set when the user picks a preset; until then turns keep the thread's own config. */
  private preset: string | null = null;

  constructor(id: string, o: Launch & { resume?: string; model?: string; effort?: string }) {
    this.id = id;
    this.o = o;
    this.cwd = o.cwd;
    const { thread, server } = threadOptions(o.args);
    if (o.model) thread.model = o.model;
    this.args = server;
    this.options = thread;
    this.effortChosen = o.effort || null;
    this.chosen = thread.model;
    this.reader = Server.reader(o, server);
    this.reader.sessions.add(this);
    // A tab that can't read its thread can't do anything else.
    void this.start().catch((e) => this.ended(String(e?.message ?? e)));
  }

  private live: Out = (ev) => emit(this.id, ev);

  private write(v: Obj) {
    this.server?.write(v);
  }

  private async call(method: string, params: Obj = {}): Promise<any> {
    return (await this.wake()).call(method, params);
  }

  /** This tab's events come from `thread` now. */
  private own(thread: string) {
    if (this.thread) this.server?.threads.delete(this.thread);
    this.thread = thread;
    this.server?.threads.set(thread, this);
  }

  /** An app-server this tab uses stopped. */
  ended(message?: string) {
    this.live({ t: 'exit', message: this.closing ? undefined : message });
  }

  /** A model Codex lists. A thread can carry one it no longer does (or a bad one ATC once
   *  saved into it), and its next turn would fail, so it moves to the default. */
  private fit(model: string | undefined) {
    if (!this.listed.length || this.listed.some((m) => m.model === model || m.id === model)) return model;
    const fallback = this.listed.find((m) => m.isDefault)?.model ?? this.listed[0].model;
    this.chosen ??= fallback;
    return fallback;
  }

  /** History, models and skills from the shared reader. A resumed tab is often only read,
   *  so its own app-server waits for something to send. */
  private async start() {
    const o = this.o;
    const [skills, models, read] = await Promise.all([
      this.reader.call('skills/list', { cwds: [o.cwd] }).catch(() => ({ data: [] })),
      this.reader.call('model/list', {}).catch(() => ({ data: [] })),
      o.resume ? this.reader.call('thread/read', { threadId: o.resume, includeTurns: true }) : null,
    ]);
    if (this.closing) return;
    for (const s of (skills.data ?? []).flatMap((e: Obj) => e.skills ?? [])) if (s.enabled) this.skills.set(s.name, s);
    this.listed = models.data ?? [];
    if (read) {
      this.thread = read.thread.id;
      this.turns = (read.thread.turns ?? []).map((t: Obj) => t.id);
      const history = historyOf(read.thread);
      if (history.length) this.live({ t: 'history', events: history });
      this.live({ t: 'session', id: this.thread });
    }
    this.live({
      t: 'ready',
      commands: [...COMMANDS, ...[...this.skills.values()].map((s) => ({ name: `$${s.name}`, description: s.shortDescription || s.description }))],
      models: this.listed.filter((m) => !m.hidden).map(toModel),
      model: this.fit(this.chosen ?? read?.thread.model),
      modes: Object.keys(PRESETS),
      effort: this.effortChosen,
    });
    if (o.resume) this.live({ t: 'dormant' });
    else void this.wake().catch((e) => this.live({ t: 'error', message: String(e?.message ?? e) }));
  }

  /** This tab's own app-server, with the thread loaded in it. */
  wake(): Promise<Server> {
    if (this.closing) return Promise.reject(new Error('The tab closed'));
    this.waking ??= (async () => {
      const s = (this.server = new Server('', this.o, this.args));
      s.sessions.add(this);
      const o = { cwd: this.o.cwd, ...this.options };
      const r = this.thread ? await s.call('thread/resume', { threadId: this.thread, ...o }) : await s.call('thread/start', o);
      if (!this.thread) this.live({ t: 'session', id: r.thread.id });
      this.own(r.thread.id);
      if (r.thread.turns?.length) this.turns = r.thread.turns.map((t: Obj) => t.id);
      const model = this.fit(this.chosen ?? r.model);
      if (model) this.live({ t: 'model', model });
      if (!this.preset) this.live({ t: 'mode', mode: presetOf(r.sandbox) });
      return s;
    })().catch((e) => {
      // Another process may hold the thread; the next message tries again.
      this.server?.release(this);
      this.server = this.waking = undefined;
      throw e;
    });
    return this.waking;
  }

  notify(method: string, p: Obj) {
    switch (method) {
      case 'turn/started':
        this.turn = p.turn.id;
        if (!this.turns.includes(p.turn.id)) this.turns.push(p.turn.id);
        this.live({ t: 'working', on: true });
        return;
      case 'turn/completed':
        this.live({ t: 'working', on: false });
        if (p.turn.status === 'interrupted') this.live({ t: 'item', item: { id: `int:${p.turn.id}`, kind: 'notice', text: 'Interrupted' } });
        if (p.turn.status === 'failed') this.live({ t: 'item', item: { id: `err:${p.turn.id}`, kind: 'notice', text: p.turn.error?.message ?? 'The turn failed' } });
        this.live({ t: 'item', item: { id: `turn:${p.turn.id}`, kind: 'turn', durationMs: p.turn.durationMs ?? undefined } });
        return;
      case 'item/started':
      case 'item/completed': {
        const item = itemOf(p.item);
        if (item) this.live({ t: 'item', item: item.kind === 'user' ? { ...item, turn: p.turnId } : item });
        else this.seen(`item ${p.item?.type}`);
        if (item?.kind === 'tool' && item.done) this.live({ t: 'result', id: item.id, output: item.output ?? '', error: !!item.error, declined: item.declined });
        return;
      }
      // With `approvals_reviewer = "auto_review"` Codex's own reviewer answers approvals;
      // say what it decided, since no card asked the user.
      case 'item/autoApprovalReview/completed': {
        const a = p.action ?? {};
        const what = a.command ?? (a.program ? [a.program, ...(a.argv ?? [])].join(' ') : a.files?.join(', ') ?? a.target ?? (a.toolName ? `${a.server}.${a.toolName}` : a.reason ?? a.type));
        const risk = p.review?.riskLevel ? ` (${p.review.riskLevel} risk)` : '';
        this.live({ t: 'item', item: { id: `review:${p.reviewId}`, kind: 'notice', text: `Codex's reviewer ${p.review?.status ?? 'decided'}${risk}: ${firstLine(String(what))}` } });
        return;
      }
      case 'turn/plan/updated':
        this.live({ t: 'plan', steps: (p.plan ?? []).map((s: Obj) => ({ text: s.step, status: s.status === 'completed' ? 'done' : s.status === 'inProgress' ? 'active' : 'pending' })) });
        return;
      case 'item/agentMessage/delta':
        this.live({ t: 'delta', id: p.itemId, kind: 'assistant', text: p.delta });
        return;
      case 'item/reasoning/summaryTextDelta':
        this.live({ t: 'delta', id: p.itemId, kind: 'thinking', text: p.delta });
        return;
      case 'item/commandExecution/outputDelta':
        this.live({ t: 'output', id: p.itemId, text: p.delta });
        return;
      case 'error':
        this.live({ t: 'item', item: { id: `e${++this.n}`, kind: 'notice', text: `${p.willRetry ? 'Retrying: ' : ''}${p.error?.message ?? 'Error'}` } });
        return;
    }
    this.seen(method);
  }

  /** Logs each thing ATC ignores once, so sidecar.log shows what a new Codex sends. */
  private ignored = new Set<string>();
  private seen(what: string) {
    if (this.ignored.has(what)) return;
    this.ignored.add(what);
    log(this.id, 'codex ignores', what);
  }

  request(rpc: number | string, method: string, p: Obj) {
    log(this.id, 'codex asks', method, JSON.stringify(p).slice(0, 300));
    const id = `r${++this.n}`;
    let request: AgentRequest;
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const command = p.command ?? (Array.isArray(p.command) ? p.command.join(' ') : '');
      request = { id, kind: 'permission', tool: 'Shell', input: firstLine(String(command)), body: [command, p.reason].filter(Boolean).join('\n\n'), always: true };
    } else if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      request = { id, kind: 'permission', tool: 'Edit', input: p.grantRoot ?? 'Apply changes', body: p.reason ?? '', always: true };
    } else if (method === 'item/permissions/requestApproval') {
      request = { id, kind: 'permission', tool: 'Permissions', input: p.reason ?? 'Wider access', body: JSON.stringify(p.permissions, null, 2), always: true };
    } else if (method === 'item/tool/requestUserInput') {
      const questions = (p.questions ?? []).map((q: Obj) => ({ id: q.id, question: q.question, header: q.header, options: q.options ?? [] }));
      request = { id, kind: 'question', tool: 'Question', input: questions[0]?.question ?? '', questions };
    } else {
      this.write({ id: rpc, error: { code: -32601, message: `ATC does not handle ${method}` } });
      return;
    }
    this.requests.set(id, { rpc, method, params: p });
    this.live({ t: 'request', request });
  }

  answer(request: string, a: Answer) {
    const r = this.requests.get(request);
    if (!r) return;
    this.requests.delete(request);
    let result: Obj;
    if (r.method === 'item/tool/requestUserInput') result = { answers: Object.fromEntries(Object.entries(a.answers ?? {}).map(([q, labels]) => [q, { answers: labels }])) };
    else if (r.method === 'item/permissions/requestApproval') result = a.allow ? { permissions: r.params.permissions, scope: a.always ? 'session' : 'turn' } : { permissions: {} };
    else if (r.method === 'execCommandApproval' || r.method === 'applyPatchApproval') result = { decision: a.allow ? (a.always ? 'approved_for_session' : 'approved') : 'abort' };
    else result = { decision: a.allow ? (a.always ? 'acceptForSession' : 'accept') : 'decline' };
    this.write({ id: r.rpc, result });
    this.live({ t: 'resolved', id: request });
  }

  /** `$name` in a message invokes that skill, as in Codex's TUI; a message that is one of
   *  COMMANDS runs it. */
  send(text: string, images: Image[] = []) {
    const command = /^\/(\w+)\s*([\s\S]*)$/.exec(text.trim());
    if (command && !images.length && COMMANDS.some((c) => c.name === `/${command[1]}`)) return void this.command(command[1], command[2].trim());
    const skills = [...text.matchAll(/\$([\w:.-]+)/g)].map((m) => this.skills.get(m[1])).filter(Boolean) as Obj[];
    const input = [
      ...(text ? [{ type: 'text', text }] : []),
      ...images.map((i) => ({ type: 'image', url: `data:${i.mediaType};base64,${i.data}` })),
      ...skills.map((s) => ({ type: 'skill', name: s.name, path: s.path })),
    ];
    this.live({ t: 'working', on: true });
    // After wake(), which gives a new tab its thread.
    this.wake().then((s) => s.call('turn/start', {
      threadId: this.thread,
      input,
      ...(this.chosen ? { model: this.chosen } : {}),
      ...(this.effortChosen ? { effort: this.effortChosen } : {}),
      ...(this.preset ? PRESETS[this.preset] : {}),
    })).catch((e) => {
      this.live({ t: 'working', on: false });
      this.live({ t: 'error', message: String(e?.message ?? e) });
    });
  }

  interrupt() {
    if (this.turn && this.server) void this.call('turn/interrupt', { threadId: this.thread, turnId: this.turn }).catch((e) => log(this.id, 'interrupt:', String(e)));
  }

  /** The preset applies from the next turn, which carries it. */
  mode(mode: string) {
    if (!PRESETS[mode]) return;
    this.preset = mode;
    this.live({ t: 'mode', mode });
  }

  private async command(name: string, args: string) {
    this.live({ t: 'item', item: { id: `cmd${++this.n}`, kind: 'user', text: `/${name}${args ? ' ' + args : ''}` } });
    const say = (text: string) => this.live({ t: 'item', item: { id: `cmd${++this.n}`, kind: 'notice', text } });
    try {
      await this.wake();
      if (name === 'compact') {
        await this.call('thread/compact/start', { threadId: this.thread });
      } else if (name === 'review') {
        this.live({ t: 'working', on: true });
        await this.call('review/start', { threadId: this.thread, delivery: 'inline', target: args ? { type: 'custom', instructions: args } : { type: 'uncommittedChanges' } });
      } else if (name === 'undo') {
        const last = this.turns.at(-1);
        if (!last) return say('Nothing to undo');
        await this.revert(last);
      } else if (name === 'new') {
        const r = await this.call('thread/start', { cwd: this.cwd, ...(this.chosen ? { model: this.chosen } : {}) });
        this.own(r.thread.id);
        this.turns = [];
        this.live({ t: 'clear' });
        this.live({ t: 'session', id: this.thread });
        say('New thread');
      } else if (name === 'rename') {
        if (!args) return say('Usage: /rename <name>');
        await this.call('thread/name/set', { threadId: this.thread, name: args });
        say(`Renamed to ${args}`);
      }
    } catch (e) {
      this.live({ t: 'working', on: false });
      this.live({ t: 'error', message: `/${name}: ${(e as Error).message}` });
    }
  }

  rewind(turn: string) {
    return this.revert(turn).catch((e) => this.live({ t: 'error', message: `Can't rewind: ${e?.message ?? e}` }));
  }

  /** Drop `turn` and every turn after it, then show the thread as it now stands. Files stay
   *  as they are: app-server's revert changes only the history. */
  async revert(turn: string) {
    await this.call('thread/revert', { threadId: this.thread, beforeTurnId: turn });
    // The revert's thread comes back without turns.
    const r = await this.call('thread/read', { threadId: this.thread, includeTurns: true });
    this.turns = (r.thread?.turns ?? []).map((t: Obj) => t.id);
    this.live({ t: 'clear' });
    this.live({ t: 'history', events: historyOf(r.thread ?? {}) });
  }

  /** Codex takes effort per turn, so this applies from the next message. */
  effort(effort: string | null) {
    this.effortChosen = effort;
    this.live({ t: 'effort', effort });
  }

  model(model: string) {
    this.chosen = model;
    this.live({ t: 'model', model });
  }

  close() {
    this.closing = true;
    this.reader.release(this);
    this.server?.release(this);
    this.live({ t: 'exit' });
  }
}
