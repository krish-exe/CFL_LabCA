import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // The API runs on HTTPS with a self-signed certificate; the proxy keeps the app same-origin.
    proxy: { '/api': { target: 'https://localhost:8443', secure: false } },
  },
});
