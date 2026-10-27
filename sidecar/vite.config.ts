import { defineConfig } from 'vite';

// The sidecar and the Agent SDK in one file. main.go embeds it with the rest of dist/.
export default defineConfig({
  build: {
    ssr: 'sidecar/agent.ts',
    outDir: 'dist/sidecar',
    emptyOutDir: false,
    target: 'node18',
    rollupOptions: { output: { entryFileNames: 'agent.mjs' } },
  },
  ssr: { noExternal: true },
});
