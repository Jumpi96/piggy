/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'Piggy - Personal Finance',
        short_name: 'Piggy',
        description: 'Personal finance tracker with offline support',
        theme_color: '#10B981',
        background_color: '#f9fafb',
        display: 'standalone',
        scope: '/piggy/',
        start_url: '/piggy/',
        icons: [
          {
            src: 'favicon.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'favicon.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,data}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Don't cache API calls - we handle offline with SQLite
        navigateFallback: '/piggy/index.html',
        navigateFallbackDenylist: [/^\/piggy\/rest\//, /supabase/],
      },
    }),
  ],
  base: '/piggy/',
  resolve: {
    alias: {
      'node:crypto': path.resolve(__dirname, 'src/lib/ledger/crypto-shim.ts'),
      'node:path': 'path-browserify',
      'node:fs/promises': path.resolve(__dirname, 'src/lib/ledger/empty-shim.ts'),
      'node:child_process': path.resolve(__dirname, 'src/lib/ledger/empty-shim.ts'),
      'node:os': path.resolve(__dirname, 'src/lib/ledger/empty-shim.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  build: {
    target: 'esnext',
  },
  // Required for PGlite WASM to work properly
  assetsInclude: ['**/*.wasm', '**/*.data'],
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/setup.ts',
      ],
    },
  },
})
