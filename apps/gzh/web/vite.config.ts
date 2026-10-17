import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  root,
  publicDir: "public",
  build: {
    outDir: path.join(root, "../dist"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    port: 5173,
  },
});
