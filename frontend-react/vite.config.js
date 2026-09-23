import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },

  server: {
    port: 8081,

    proxy: {
      '/assets/surveillance/images': {
        target: 'http://surveillance.local:8000',
        changeOrigin: true,
      },

      '/api': {
        target: 'http://surveillance.local:8000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: '../surveillance/public/frontend',
    emptyOutDir: true,
  },

  base: command === 'serve'
    ? '/'
    : '/assets/surveillance/frontend/',
}))