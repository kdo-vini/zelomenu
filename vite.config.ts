import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function preloadEntryCss(): Plugin {
  return {
    name: 'preload-entry-css',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.bundle) return html;

        const entryCss = Object.keys(context.bundle).find(
          (fileName) => fileName.startsWith('assets/index-') && fileName.endsWith('.css'),
        );
        if (!entryCss) return html;

        return {
          html,
          tags: [{
            tag: 'link',
            injectTo: 'head-prepend',
            attrs: { rel: 'preload', as: 'style', href: `/${entryCss}` },
          }],
        };
      },
    },
  };
}

// Standalone ZeloMenu owner-config app. Mirrors the ZeloChat Vite setup
// (React + Tailwind v4 via @tailwindcss/vite, `@` alias to project root).
export default defineConfig({
  plugins: [preloadEntryCss(), react(), tailwindcss()],
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
        },
      },
    },
  },
});
