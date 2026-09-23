import type { AgentProvider, SessionMeta } from '../types';

export const providerName = (provider: AgentProvider): string => provider === 'codex' ? 'Codex' : 'Claude';
export const sessionKey = (session: Pick<SessionMeta, 'provider' | 'id'>): string => `${session.provider}:${session.id}`;

/** Only legacy stored identities omit the provider. Native IDs are never changed. */
export function qualifiedSession(id: string): string {
  return /^(claude|codex):/.test(id) ? id : `claude:${id}`;
}

export function migrateSessionNames(names: Record<string, string>): Record<string, string> {
  const migrated: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) {
    const key = qualifiedSession(id);
    migrated[key] = names[key] ?? name;
  }
  return migrated;
}
