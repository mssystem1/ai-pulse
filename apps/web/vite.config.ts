import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  // Keep one repository-level environment contract for API and web; Vite only
  // exposes variables prefixed with VITE_ to browser code.
  envDir: "../../",
  plugins: [
    react(),
    nodePolyfills({
      include: ["crypto", "buffer", "stream", "util"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    proxy: {
      // Optional same-origin proxy if VITE_USE_PROXY=1
      "/v1": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/mcp": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/brand": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },
  clearScreen: false,
});
