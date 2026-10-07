<script lang="ts">
  import type { TabMark } from './format';

  let { mark, title }: { mark: TabMark; title: string } = $props();
</script>

<span class="dot {mark}" {title} aria-label={title}></span>

<style>
  .dot {
    display: inline-block;
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .open {
    box-shadow: inset 0 0 0 1px var(--fg-faint);
  }
  .idle {
    background: var(--ok);
  }
  .interrupted {
    background: var(--danger);
  }
  .attention {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 27%, transparent);
  }
  .working {
    background: var(--warn);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .working {
      animation: none;
    }
  }
</style>
