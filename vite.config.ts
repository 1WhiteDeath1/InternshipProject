import path from "path"
import fs from "fs"
import os from "os"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// backend/dev_server.py (the preview harness's entrypoint) publishes its
// actually-bound port here, since two independently-launched dev processes
// have no other way to share a harness-assigned port. Falls back to the
// documented default (8000) if the backend hasn't published yet or was
// started via start.bat/start.sh instead.
const BACKEND_PORT_FILE = path.join(os.tmpdir(), "hotel-mess-dev-backend-port.txt")
function backendTarget() {
  try {
    const port = fs.readFileSync(BACKEND_PORT_FILE, "utf-8").trim()
    if (port) return `http://127.0.0.1:${port}`
  } catch { /* not published yet - fall back */ }
  return 'http://127.0.0.1:8000'
}

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    proxy: {
      '/api': {
        target: backendTarget(),
        changeOrigin: true,
      },
      '/docs': {
        target: backendTarget(),
        changeOrigin: true,
      },
      '/openapi.json': {
        target: backendTarget(),
        changeOrigin: true,
      },
      '/uploads': {
        target: backendTarget(),
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
