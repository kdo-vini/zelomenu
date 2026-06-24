import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Standalone ZeloMenu owner-config app. Mirrors the ZeloChat Vite setup
// (React + Tailwind v4 via @tailwindcss/vite, `@` alias to project root).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3100,
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion-vendor': ['motion'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
});
