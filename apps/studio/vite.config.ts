import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
        headers: {
          Origin: "http://127.0.0.1:8788",
        },
      },
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "../../dist/studio",
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/@tiptap/") || id.includes("/node_modules/prosemirror-")
            ? "editor"
            : undefined;
        },
      },
    },
  },
});
