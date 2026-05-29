import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Tauri serves the bundle from the `tauri://localhost` custom protocol, where
// Vite's default `crossorigin` module-script attribute makes WKWebView refuse to
// load the script (blank window). Strip it from the generated index.html.
function stripCrossorigin() {
  return {
    name: "strip-crossorigin",
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin/g, "");
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), stripCrossorigin()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aimux": path.resolve(__dirname, "../src"),
      "@aimux-config": path.resolve(__dirname, "../packages/aimux-config/src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
