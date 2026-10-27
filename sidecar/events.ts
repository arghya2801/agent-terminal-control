import type { AgentEvent } from './protocol.ts';

/** One line to Go, which routes it to the session's channel. */
export function emit(id: string, ev: AgentEvent) {
  process.stdout.write(JSON.stringify({ id, ev }) + '\n');
}

/** Goes to Go's sidecar.log. */
export function log(...parts: unknown[]) {
  process.stderr.write(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n');
}

/** Messages waiting for an async consumer, here the SDK's streaming prompt. */
export class Inbox<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(v: T) {
    this.items.push(v);
    this.wake?.();
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

const OUTPUT_CAP = 8 * 1024;

export function clip(s: string, n = OUTPUT_CAP): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export function firstLine(s: string): string {
  return clip(s.trim().split('\n')[0].trim(), 200);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Text of a string or of an array of content blocks, one block per line. */
export function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v.map((b) => str(b?.text)).filter(Boolean).join('\n');
}

const diff = (old: string, next: string) =>
  [...old.split('\n').map((l) => '-' + l), ...next.split('\n').map((l) => '+' + l)].join('\n');

/** A tool call's one-line summary and the body shown when it is opened. Edits become
 *  -/+ lines, so one renderer draws them and Codex's patches. */
export function summarize(tool: string, input: Record<string, unknown>): { input: string; body: string } {
  switch (tool) {
    case 'Bash':
      return { input: firstLine(str(input.command)), body: clip(str(input.command)) };
    case 'Edit':
      return { input: str(input.file_path), body: clip(diff(str(input.old_string), str(input.new_string))) };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return { input: str(input.file_path), body: clip(edits.map((e) => diff(str(e?.old_string), str(e?.new_string))).join('\n')) };
    }
    case 'Write':
      return { input: str(input.file_path), body: clip(str(input.content)) };
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? input.questions : [];
      return { input: firstLine(str(qs[0]?.question)), body: qs.map((q) => [str(q?.question), ...(q?.options ?? []).map((o: { label?: string }) => `- ${str(o?.label)}`)].join('\n')).join('\n\n') };
    }
    case 'ExitPlanMode':
      return { input: 'Plan', body: clip(str(input.plan), 64 * 1024) };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const mark = (s: string) => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]');
      return { input: `${todos.length} todos`, body: todos.map((t) => `${mark(str(t?.status))} ${str(t?.content)}`).join('\n') };
    }
  }
  const keys = ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'query', 'prompt', 'skill'];
  const first = keys.map((k) => str(input[k])).find(Boolean) ?? Object.values(input).map(str).find(Boolean) ?? '';
  return { input: firstLine(first), body: clip(JSON.stringify(input, null, 2)) };
}
