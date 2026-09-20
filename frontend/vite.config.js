import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend calls the backend through a dev proxy so the browser only ever
// talks to one origin (avoids CORS friction in dev). In production the reverse
// proxy serves both under one host.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
})
