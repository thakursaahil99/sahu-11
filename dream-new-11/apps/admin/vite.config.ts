import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // One React instance: the router and react-query must use the same copy as the app.
    dedupe: ['react', 'react-dom'],
    alias: {
      // Use the shared package's TypeScript source (ESM) rather than its CommonJS build.
      '@dream11/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5174, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than the app: separate chunks cache better.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          data: ['@tanstack/react-query', 'zod'],
          ui: ['lucide-react', 'qrcode'],
        },
      },
    },
  },
});
