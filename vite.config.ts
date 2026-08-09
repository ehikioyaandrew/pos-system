import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || 'localhost',
    watch: {
      // Rust rebuilds lock DLLs here; watching them crashes Vite on Windows (EBUSY)
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri uses Chromium on Windows / WebKit on macOS
    target: process.env.TAURI_ENV_PLATFORM ? 'chrome105' : ['es2021', 'chrome100', 'safari13'],
    minify: 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
