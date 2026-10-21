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
    transition: background-color var(--enter), box-shadow var(--enter);
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
  /* Rings out twice when it lands, then holds: the one thing here that moves unasked. */
  .attention {
    background: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 27%, transparent);
    animation: ping 0.9s var(--ease-out) 2;
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
  @keyframes ping {
    from {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent);
    }
    to {
      box-shadow: 0 0 0 7px transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .working,
    .attention {
      animation: none;
    }
  }
</style>
