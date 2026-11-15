import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import naga from './plugins/naga.ts';

export default defineConfig({
  plugins: [naga()],
  build: {
    target: 'es2022',
    rollupOptions: {
      // spike.html (the colour test card) is dev-only
      input: { main: resolve(import.meta.dirname, 'index.html') },
    },
  },
});
