import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // web/node_modules holds a frozen pnpm copy of shared; read the live source instead.
  resolve: {
    alias: { '@gtr/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
});
