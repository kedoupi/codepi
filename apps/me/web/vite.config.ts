import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { outDir: "../dist", emptyOutDir: true },
});
