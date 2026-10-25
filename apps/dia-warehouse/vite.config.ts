import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Warehouse app (phone-first). The dev server proxies the API to dia-backend (default :8000); `host: true` lets a
// phone on the same Wi-Fi open http://<this PC's IP>:3002.
const backend = process.env.VITE_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { port: 3002, host: true, proxy: { "/v1": backend } },
});
