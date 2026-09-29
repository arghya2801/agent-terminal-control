import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Wails drives the dev server; it needs a fixed port and must not silently
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
      // Generated trees and test data change constantly; watching them causes reload storms.
      ignored: ['**/playground/**', '**/fixtures/**', '**/build/**', '**/benchmarks/**', '**/wails-dev-work/**', '**/.wails-dev/**', '**/.go-cache/**'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
