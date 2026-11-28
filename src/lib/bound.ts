/**
 * The Go methods (`bun run bindings` generates them from App). They reject with the Go
 * error's message, as Wails v2 did, so callers that show `String(e)` read the same.
 */
import * as Bound from '../bindings/atc/app';

const message = (e: unknown) => (e instanceof Error ? e.message : e);

export const App = new Proxy(Bound, {
  get(target, name) {
    const f = (target as Record<string | symbol, unknown>)[name];
    return typeof f === 'function'
      ? (...args: unknown[]) => (f as (...a: unknown[]) => Promise<unknown>)(...args).catch((e: unknown) => Promise.reject(message(e)))
      : f;
  },
}) as typeof Bound;
