import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri drives the dev server; it needs a fixed port and must not silently
// fall back to another one, or the webview points at nothing.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    // The bundle is loaded from disk by the webview, never over a network, so one
    // ~600 kB chunk (mostly xterm and its WebGL addon) costs nothing to split out.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is rebuilt by cargo, not vite; watching it causes reload storms.
      ignored: ['**/src-tauri/**', '**/playground/**', '**/fixtures/**'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // TS units land with terminal/paneGroup in phase 1; until then an empty run is
    // a pass, not a failure. Rust carries the phase-0 test weight.
    passWithNoTests: true,
  },
});
