import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: false },
      "^/n(?:/|$)": { target: "http://127.0.0.1:3001", changeOrigin: false },
      "/oauth": { target: "http://127.0.0.1:3001", changeOrigin: false },
      "/.well-known": { target: "http://127.0.0.1:3001", changeOrigin: false },
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    license: { fileName: "third-party-licenses.txt" },
    rolldownOptions: {
      output: {
        comments: { legal: true },
        banner:
          "/*! Third-party licenses: /third-party-licenses.txt; additional notices: /third-party-notices.txt */",
      },
    },
  },
});
