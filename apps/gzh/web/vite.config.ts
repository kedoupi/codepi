import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
