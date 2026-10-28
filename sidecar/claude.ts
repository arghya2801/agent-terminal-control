import { getSessionMessages, query, type ModelInfo, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { clip, emit, Inbox, log, summarize, textOf } from './events.ts';
import type { AgentEvent, AgentRequest, Answer, Model } from './protocol.ts';

/** How a Claude process starts, from settings: the CLI, its arguments, extra environment. */
type Launch = { cwd: string; exe: string; args: string[]; env?: Record<string, string> };

function launchOptions(id: string, o: Launch) {
  return {
    cwd: o.cwd,
    pathToClaudeCodeExecutable: o.exe,
    executable: o.exe.endsWith('.js') ? ('node' as const) : undefined,
    settingSources: ['user' as const, 'project' as const, 'local' as const],
    extraArgs: extraArgs(o.args),
    env: { ...process.env, ...o.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'atc' },
    stderr: (d: string) => log(id, 'claude:', d.trimEnd()),
  };
}

const toModel = (m: ModelInfo): Model => ({
  id: m.value,
  label: m.displayName,
  description: m.description || undefined,
  resolved: m.resolvedModel,
  efforts: m.supportsEffort ? m.supportedEffortLevels : undefined,
});

/** Claude's models without a session: start the CLI, ask, stop it. Nothing is written. */
export async function claudeCatalog(id: string, o: Launch): Promise<Model[]> {
  const inbox = new Inbox<SDKUserMessage>();
  const q = query({ prompt: inbox, options: launchOptions(id, o) });
  try {
    return (await q.initializationResult()).models.map(toModel);
  } finally {
    inbox.end();
    q.close();
  }
}

type Out = (ev: AgentEvent) => void;
type Block = Record<string, any>;

const MODES = ['default', 'acceptEdits', 'plan', 'auto'];

/** Settings arguments as the SDK's extraArgs: `--flag value`, `--flag=value` or `--flag`. */
export function extraArgs(args: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < args.length && !args[i + 1].startsWith('--')) out[a.slice(2)] = args[++i];
    else out[a.slice(2)] = null;
  }
  return out;
}

/** What a user record says, if a person said it: commands become `/name args`, and the
 *  context Claude wraps in tags is dropped. */
function promptOf(text: string): AgentEvent | null {
  const command = /<command-name>(.*?)<\/command-name>/s.exec(text);
  if (command) {
    const args = /<command-args>(.*?)<\/command-args>/s.exec(text)?.[1] ?? '';
    return { t: 'item', item: { id: '', kind: 'user', text: `${command[1]} ${args}`.trim() } };
  }
  const stdout = /<local-command-stdout>(.*?)<\/local-command-stdout>/s.exec(text);
  if (stdout) return stdout[1].trim() ? { t: 'item', item: { id: '', kind: 'notice', text: clip(stdout[1].trim()) } } : null;
  if (text.startsWith('[Request interrupted')) return { t: 'item', item: { id: '', kind: 'notice', text: 'Interrupted' } };
  if (!text.trim() || text.trimStart().startsWith('<') || text.startsWith('Caveat:')) return null;
  return { t: 'item', item: { id: '', kind: 'user', text } };
}

/** One Claude Code session through the Agent SDK: the same CLI, settings, hooks, skills
 *  and session files as in a terminal, without the TUI. */
export class Claude {
  private id: string;
  private inbox = new Inbox<SDKUserMessage>();
  private q: Query;
  private waiting = new Map<string, (a: Answer) => void>();
  /** Content blocks seen per assistant message, so a block matches the stream that drew it. */
  private blocks = new Map<string, number>();
  /** The message streaming now, per subagent (null is the main thread). */
  private streaming = new Map<string | null, string>();
  private n = 0;
  private closing = false;

  constructor(id: string, o: Launch & { resume?: string; model?: string; effort?: string }) {
    this.id = id;
    this.q = query({
      prompt: this.inbox,
      options: {
        ...launchOptions(id, o),
        resume: o.resume || undefined,
        model: o.model || undefined,
        effort: (o.effort || undefined) as never,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        canUseTool: (tool, input, { signal, suggestions }) => this.ask(tool, input, suggestions, signal),
      },
    });
    void this.start(o);
  }

  private live: Out = (ev) => emit(this.id, ev);

  private async start(o: { cwd: string; resume?: string; effort?: string }) {
    if (o.resume) {
      const history: AgentEvent[] = [];
      try {
        for (const m of await getSessionMessages(o.resume, { dir: o.cwd })) this.handle(m as unknown as SDKMessage, (ev) => history.push(ev));
      } catch (e) {
        log(this.id, 'history:', String(e));
      }
      this.live({ t: 'history', events: history });
      this.live({ t: 'session', id: o.resume });
    }
    void this.q
      .initializationResult()
      .then((init) =>
        this.live({
          t: 'ready',
          commands: init.commands.map((c) => ({ name: `/${c.name}`, description: c.description, hint: c.argumentHint || undefined })),
          models: init.models.map(toModel),
          mode: (init as { current_permission_mode?: string }).current_permission_mode,
          modes: MODES,
          effort: o.effort || null,
        }),
      )
      // A session that fails to start says so in its exit.
      .catch((e) => log(this.id, 'initialize:', String(e?.message ?? e)));
    try {
      for await (const m of this.q) this.handle(m, this.live);
      this.live({ t: 'exit' });
    } catch (e) {
      this.live({ t: 'exit', message: this.closing ? undefined : String((e as Error)?.message ?? e) });
    }
  }

  private handle(m: SDKMessage, out: Out) {
    const parent = 'parent_tool_use_id' in m ? (m.parent_tool_use_id ?? null) : null;
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          out({ t: 'session', id: m.session_id });
          out({ t: 'model', model: m.model });
          out({ t: 'mode', mode: m.permissionMode });
        } else if (m.subtype === 'compact_boundary') out({ t: 'item', item: { id: m.uuid, kind: 'notice', text: 'Conversation compacted' } });
        else if (m.subtype === 'api_retry') out({ t: 'item', item: { id: m.uuid, kind: 'notice', text: `API error, retrying (attempt ${m.attempt} of ${m.max_retries})` } });
        else if (m.subtype === 'local_command_output') out({ t: 'item', item: { id: m.uuid, kind: 'notice', text: clip(m.content) } });
        return;
      case 'stream_event': {
        const e = m.event as Block;
        if (e.type === 'message_start') this.streaming.set(parent, e.message.id);
        else if (e.type === 'content_block_start') {
          const b = e.content_block;
          const id = `${this.streaming.get(parent)}:${e.index}`;
          if (b.type === 'text' || b.type === 'thinking') out({ t: 'item', item: { id, kind: b.type === 'text' ? 'assistant' : 'thinking', text: '', parent } });
          else if (b.type === 'tool_use' || b.type === 'server_tool_use') out({ t: 'item', item: { id: b.id, kind: 'tool', tool: b.name, input: '', parent } });
        } else if (e.type === 'content_block_delta') {
          const id = `${this.streaming.get(parent)}:${e.index}`;
          if (e.delta.type === 'text_delta') out({ t: 'delta', id, kind: 'assistant', text: e.delta.text, parent });
          else if (e.delta.type === 'thinking_delta') out({ t: 'delta', id, kind: 'thinking', text: e.delta.thinking, parent });
        }
        return;
      }
      case 'assistant': {
        const mid = m.message.id;
        for (const b of m.message.content as Block[]) {
          const k = this.blocks.get(mid) ?? 0;
          this.blocks.set(mid, k + 1);
          const id = `${mid}:${k}`;
          if (b.type === 'text') out({ t: 'item', item: { id, kind: 'assistant', text: b.text, parent } });
          else if (b.type === 'thinking' && b.thinking) out({ t: 'item', item: { id, kind: 'thinking', text: b.thinking, parent } });
          else if (b.type === 'tool_use' || b.type === 'server_tool_use') out({ t: 'item', item: { id: b.id, kind: 'tool', tool: b.name, ...summarize(b.name, b.input ?? {}), parent } });
        }
        if (m.error) out({ t: 'item', item: { id: m.uuid, kind: 'notice', text: `API error: ${m.error}` } });
        return;
      }
      case 'user': {
        const content = m.message.content;
        if (typeof content === 'string') {
          const ev = promptOf(content);
          if (ev?.t === 'item') out({ t: 'item', item: { ...ev.item, id: m.uuid ?? `u${++this.n}`, parent } });
          return;
        }
        for (const b of content as Block[]) {
          if (b.type === 'tool_result') out({ t: 'result', id: b.tool_use_id, output: clip(textOf(b.content)), error: !!b.is_error });
          else if (b.type === 'text') {
            const ev = promptOf(b.text);
            if (ev?.t === 'item') out({ t: 'item', item: { ...ev.item, id: `${m.uuid ?? 'u'}:${++this.n}`, parent } });
          }
        }
        return;
      }
      case 'result':
        out({ t: 'working', on: false });
        if (m.num_turns) out({ t: 'item', item: { id: m.uuid, kind: 'turn', durationMs: m.duration_ms, costUsd: m.total_cost_usd } });        if (m.subtype !== 'success') out({ t: 'item', item: { id: `${m.uuid}:e`, kind: 'notice', text: m.errors.join('\n') || m.subtype } });
        return;
      case 'tool_progress':
        out({ t: 'progress', id: m.tool_use_id, seconds: m.elapsed_time_seconds });
        return;
    }
  }

  private async ask(tool: string, input: Record<string, unknown>, suggestions: PermissionUpdate[] | undefined, signal: AbortSignal): Promise<PermissionResult> {
    const id = `r${++this.n}`;
    const kind = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'permission';
    const asked = Array.isArray(input.questions) ? (input.questions as Block[]) : [];
    const request: AgentRequest = {
      id,
      kind,
      tool,
      ...summarize(tool, input),
      ...(kind === 'plan' ? { body: String(input.plan ?? '') } : {}),
      ...(kind === 'question'
        ? { questions: asked.map((q) => ({ id: q.question, question: q.question, header: q.header, multi: !!q.multiSelect, options: q.options ?? [] })) }
        : {}),
      always: !!suggestions?.length,
    };
    this.live({ t: 'request', request });
    const answer = await new Promise<Answer>((resolve) => {
      this.waiting.set(id, resolve);
      signal.addEventListener('abort', () => resolve({ allow: false, message: 'Cancelled' }));
    });
    this.waiting.delete(id);
    this.live({ t: 'resolved', id });
    if (!answer.allow) return { behavior: 'deny', message: answer.message || 'The user declined this.' };
    if (kind === 'question') {
      const answers = Object.fromEntries(Object.entries(answer.answers ?? {}).map(([q, labels]) => [q, labels.join(', ')]));
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    return { behavior: 'allow', updatedInput: input, ...(answer.always && suggestions ? { updatedPermissions: suggestions } : {}) };
  }

  send(text: string) {
    // `/clear` starts the CLI on a fresh conversation; the view starts over with it.
    if (text.trim() === '/clear') this.live({ t: 'clear' });
    this.live({ t: 'item', item: { id: `you${++this.n}`, kind: 'user', text } });
    this.live({ t: 'working', on: true });
    this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' } as SDKUserMessage);
  }

  answer(request: string, a: Answer) {
    this.waiting.get(request)?.(a);
  }

  interrupt() {
    void this.q.interrupt().catch((e) => log(this.id, 'interrupt:', String(e)));
  }

  mode(mode: string) {
    void this.q
      .setPermissionMode(mode as never)
      .then(() => this.live({ t: 'mode', mode }))
      .catch((e) => this.live({ t: 'error', message: `Can't switch to ${mode}: ${e?.message ?? e}` }));
  }

  effort(effort: string | null) {
    void this.q
      .applyFlagSettings({ effortLevel: effort as never })
      .then(() => this.live({ t: 'effort', effort }))
      .catch((e) => this.live({ t: 'error', message: `Can't set effort to ${effort}: ${e?.message ?? e}` }));
  }

  model(model: string) {
    void this.q
      .setModel(model)
      .then(() => this.live({ t: 'model', model }))
      .catch((e) => this.live({ t: 'error', message: `Can't switch to ${model}: ${e?.message ?? e}` }));
  }

  close() {
    this.closing = true;
    for (const resolve of this.waiting.values()) resolve({ allow: false, message: 'Session closed' });
    this.inbox.end();
    this.q.close();
  }
}
