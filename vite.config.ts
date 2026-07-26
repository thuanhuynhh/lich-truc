import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "legacy-entry-aliases",
      apply: "build",
      writeBundle(options) {
        const outputDirectory = resolve(options.dir || "dist");
        const currentEntry = resolve(outputDirectory, "assets/index.js");
        for (const legacyEntry of ["index-dw1Yt5pg.js", "index-VcWkZwT2.js"]) {
          copyFileSync(currentEntry, resolve(outputDirectory, `assets/${legacyEntry}`));
        }
      }
    }
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js"
      }
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
