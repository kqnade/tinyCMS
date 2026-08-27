import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
