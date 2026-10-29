/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      // Deep imports of individual Monaco features (src/monacoFeatures.ts),
      // bypassing the package's exports map which hides non-JS files.
      "monaco-editor-esm": fileURLToPath(new URL("./node_modules/monaco-editor/esm/vs", import.meta.url)),
    },
  },
  clearScreen: false,
  build: {
    // The Monaco editor chunk (~4 MB) is lazy-loaded only for the LaTeX Source tab.
    chunkSizeWarningLimit: 4500,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    testTimeout: 15000,
    hookTimeout: 15000,
  },
}));
