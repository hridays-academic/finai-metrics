import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxies /api/* to the FastAPI backend during development so the frontend
// never needs to know the backend's host/port (and never touches API keys).
// The end-to-end test (backend/tests/test_e2e_core_loop.py) serves the built
// site with `vite preview`, proxied to its own backend port.
const api = { "/api": { target: process.env.E2E_API ?? "http://localhost:8000", changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: api },
  preview: { proxy: api },
});
