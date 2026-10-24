import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the API to dia-backend (default :8000). The production build is static files
// that M1's release embeds in the dia-server binary.
const backend = process.env.VITE_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, proxy: { "/v1": backend, "/openapi.json": backend, "/docs": backend } },
});
