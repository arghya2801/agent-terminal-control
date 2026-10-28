import type { Model } from '../../sidecar/protocol';
import type { AgentProvider } from '../types';

/** One row in the model picker: a family, picked as its latest version, with older ones
 *  behind an arrow. */
export interface Family {
  name: string;
  latest: Model;
  older: Model[];
  /** The latest version's number, such as "5.5". */
  version: string;
}

/** A model's family and version. Claude names them (`Opus 5.5`); Codex puts them in the id
 *  (`gpt-6.1-sol`). Claude's `default` alias belongs to no family: it is whichever one the
 *  CLI recommends. */
function parse(provider: AgentProvider, m: Model): { family: string; version: string } | null {
  if (provider === 'claude') {
    if (m.id === 'default') return null;
    const [, family, version] = /^(\D+?)\s*([\d.]+)?$/.exec(m.label.trim()) ?? [];
    return family ? { family, version: version ?? '' } : null;
  }
  const [, version, family] = /(\d+(?:\.\d+)?)-?(.*)$/.exec(m.id) ?? [];
  return { family: family ? family.charAt(0).toUpperCase() + family.slice(1) : m.label, version: version ?? '' };
}

/** A model's version number, such as "4.8", or "" when it has none. */
export const versionOf = (provider: AgentProvider, m: Model) => parse(provider, m)?.version ?? '';

const newer = (a: string, b: string) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/** The picker's rows, in the CLI's order of each family's first model. Claude's latest is
 *  its alias (`opus`), which follows new releases; Codex's is the highest version. */
export function families(provider: AgentProvider, models: Model[]): Family[] {
  const byName = new Map<string, { m: Model; version: string }[]>();
  for (const m of models) {
    const p = parse(provider, m);
    if (!p) continue;
    byName.set(p.family, [...(byName.get(p.family) ?? []), { m, version: p.version }]);
  }
  return [...byName].map(([name, all]) => {
    all.sort((a, b) => newer(a.version, b.version));
    const alias = all.find((x) => /^[a-z]+$/.test(x.m.id));
    const latest = alias ?? all[0];
    return { name, latest: latest.m, version: latest.version, older: all.filter((x) => x !== latest && x.version !== latest.version).map((x) => x.m) };
  });
}

/** The effort to keep when the model changes: the current one if the new model takes it. */
export function keptEffort(effort: string | null, model: Model | undefined): string | null {
  return effort && model?.efforts?.includes(effort) ? effort : null;
}
