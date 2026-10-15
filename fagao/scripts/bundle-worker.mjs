import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  logLevel: "info",
});

await build({
  entryPoints: ["web/src/preview-session.ts"],
  outfile: "dist/assets/preview-session.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
});

await mkdir("dist/login", { recursive: true });
await copyFile("dist/index.html", "dist/login/index.html");
