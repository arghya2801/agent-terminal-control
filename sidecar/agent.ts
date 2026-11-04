/**
 * ATC's agent sidecar: one Node process for every agent session. Go writes an AgentOp per
 * line on stdin and routes each `{id, ev}` line from stdout to that session's chat. Claude
 * runs through the Agent SDK, Codex through `codex app-server`.
 */
import { createInterface } from 'node:readline';
import { Claude, claudeCatalog } from './claude.ts';
import { Codex, codexCatalog } from './codex.ts';
import { emit, listFiles, log } from './events.ts';
import type { AgentOp, Model, Provider } from './protocol.ts';

// One process runs every chat, so a crash ends them all; sidecar.log says why.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (e) => {
    log('sidecar', event, String((e as Error)?.stack ?? e));
    process.exit(1);
  });
}

const sessions = new Map<string, Claude | Codex>();
const oldNode = Number(process.versions.node.split('.')[0]) < 18;
/** Each provider's models, asked once per sidecar: starting a CLI to ask takes a second. */
const catalogs = new Map<Provider, Promise<Model[]>>();

function run(op: AgentOp) {
  if (op.op === 'catalog') {
    if (!catalogs.has(op.provider)) {
      const asked = op.provider === 'codex' ? codexCatalog(op) : claudeCatalog(op.id, op);
      catalogs.set(op.provider, asked.catch((e) => (catalogs.delete(op.provider), Promise.reject(e))));
    }
    catalogs.get(op.provider)!.then(
      (models) => (emit(op.id, { t: 'catalog', models }), emit(op.id, { t: 'exit' })),
      (e) => emit(op.id, { t: 'exit', message: String(e?.message ?? e) }),
    );
    return;
  }
  if (op.op === 'open') {
    if (oldNode) return emit(op.id, { t: 'exit', message: `Agent sessions need Node.js 18 or later; this is ${process.version}.` });
    sessions.set(op.id, op.provider === 'codex' ? new Codex(op.id, op) : new Claude(op.id, op));
    return;
  }
  const s = sessions.get(op.id);
  if (!s) return;
  switch (op.op) {
    case 'send':
      return s.send(op.text, op.images);
    case 'interrupt':
      return s.interrupt();
    case 'answer':
      return s.answer(op.request, op.answer);
    case 'mode':
      return s.mode(op.mode);
    case 'model':
      return s.model(op.model);
    case 'effort':
      return s.effort(op.effort);
    case 'rewind':
      return void s.rewind(op.to);
    case 'wake':
      // A Codex tab that can't load its thread says so on its next message.
      return void Promise.resolve(s.wake()).catch((e) => log(op.id, 'wake:', String(e?.message ?? e)));
    case 'files':
      return void listFiles(s.cwd).then(
        (files) => emit(op.id, { t: 'files', files }),
        (e) => log(op.id, 'files:', String(e)),
      );
    case 'close':
      sessions.delete(op.id);
      return s.close();
  }
}

createInterface({ input: process.stdin })
  .on('line', (line) => {
    try {
      run(JSON.parse(line));
    } catch (e) {
      log('bad op:', String(e), line.slice(0, 200));
    }
  })
  // Go closes stdin when ATC quits.
  .on('close', () => {
    for (const s of sessions.values()) s.close();
    setTimeout(() => process.exit(0), 500);
  });
