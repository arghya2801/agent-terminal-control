<script lang="ts">
  import type { AgentProvider } from '../types';
  import { providerName } from './agents';
  let { provider }: { provider: AgentProvider } = $props();
</script>

<span class="provider" role="img" aria-label={providerName(provider)} title={providerName(provider)}>{provider === 'claude' ? '✳' : '⬡'}</span>

<style>
  .provider { flex-shrink: 0; width: 14px; text-align: center; color: var(--fg-dim); }
</style>
