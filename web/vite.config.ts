import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Overridable so the e2e suite can point the browser's own API
        // calls at its isolated backend port instead of a developer's real
        // running dev server (see e2e/tests/support/env.ts).
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4321",
        changeOrigin: true,
      },
    },
  },
});
