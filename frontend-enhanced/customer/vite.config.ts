import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], base: '/v2/', server: { port: 5174, fs: { allow: ['../..'] }, proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000' } } } })
