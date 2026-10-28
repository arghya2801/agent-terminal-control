import type { Model } from '../../sidecar/protocol';
import type { AgentProvider } from '../types';

/** The models a picker folds under "Older models". Claude lists its current models by alias
 *  (`opus`) and pins older versions by id (`claude-opus-4-8`). Codex lists ids; a model of
 *  an older major version than the newest (`gpt-5.6-sol` beside `gpt-6.1-sol`) is older. */
export function olderModels(provider: AgentProvider, models: Model[]): Model[] {
  if (provider === 'claude') return models.filter((m) => !/^[a-z]+$/.test(m.id));
  const major = (m: Model) => Number(/(\d+)(?:\.\d+)?/.exec(m.id)?.[1] ?? NaN);
  const newest = Math.max(...models.map(major).filter((n) => !Number.isNaN(n)));
  return models.filter((m) => major(m) < newest);
}

/** The effort to keep when the model changes: the current one if the new model takes it. */
export function keptEffort(effort: string | null, model: Model | undefined): string | null {
  return effort && model?.efforts?.includes(effort) ? effort : null;
}
