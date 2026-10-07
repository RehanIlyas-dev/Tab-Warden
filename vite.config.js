import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// Plain Vite, no CRXJS. The manifest lives in public/ so Vite copies it into
// dist/ unchanged, which keeps the store review diff obvious.
const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  publicDir: "public",
  build: {
    target: "chrome120",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(here, "popup.html"),
        options: resolve(here, "options.html"),
        background: resolve(here, "src/background/service-worker.js"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
})