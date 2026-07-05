import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'src/client',
  base: '/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'client/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3456',
    },
  },
});
