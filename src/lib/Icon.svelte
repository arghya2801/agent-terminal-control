<script lang="ts" module>
  /** 16px stroke icons. One set, so every glyph in the chrome has the same weight. */
  const PATHS = {
    sidebar: 'M3.75 2.75h8.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-8.5a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2zM6.25 2.75v10.5',
    plus: 'M8 3v10M3 8h10',
    agent: 'M8 1.75c.5 3.6 2.65 5.75 6.25 6.25-3.6.5-5.75 2.65-6.25 6.25-.5-3.6-2.65-5.75-6.25-6.25 3.6-.5 5.75-2.65 6.25-6.25z',
    usage: 'M2.75 13.25h10.5M4.75 10.5V8M8 10.5V4.5M11.25 10.5v-4',
    keyboard: 'M2.75 4.25h10.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1zM5 9.5h6M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01',
    settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3zM6 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3z',
    pulse: 'M1.75 8H4.5l2-4.5 3 9 2-4.5h2.75',
    chevron: 'M6 3.5 10.5 8 6 12.5',
    back: 'M10 3.5 5.5 8l4.5 4.5',
    expand: 'M5 6l3-3 3 3M5 10l3 3 3-3',
    collapse: 'M5 3.5l3 3 3-3M5 12.5l3-3 3 3',
    refresh: 'M13.25 8a5.25 5.25 0 1 1-1.54-3.71M12.5 2.5v3h-3',
    terminal: 'M2.75 3.25h10.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1zM4.75 6.5l2 1.75-2 1.75M8.5 10h2.75',
    close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    pencil: 'M10.5 2.75l2.75 2.75-7.5 7.5H3v-2.75zM9 4.25l2.75 2.75',
    folder: 'M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.5h5.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z',
    copy: 'M5.5 5.5h7.75v7.75H5.5zM10.5 5.5V2.75H2.75v7.75H5.5',
    pin: 'M6 2.75h4M7 2.75v4L4.5 9.25h7L9 6.75v-4M8 9.25V14',
    split: 'M2.75 3.25h10.5v9.5H2.75zM8 3.25v9.5',
    search: 'M7 2.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 1 1 0-8.5zM10 10l3.5 3.5',
    up: 'M8 12.5v-9M4 7.5l4-4 4 4',
    down: 'M8 3.5v9M4 8.5l4 4 4-4',
  };
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={PATHS[name]} /></svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
