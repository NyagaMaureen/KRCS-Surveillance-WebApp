import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'


export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    tailwindcss(),
  ],


  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },


  server: {
    port: 8080,


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


  // Vite dev server needs /
  // Frappe production build needs /assets/surveillance/frontend/
  base: command === 'serve'
    ? '/'
    : '/assets/surveillance/frontend/',
}))
