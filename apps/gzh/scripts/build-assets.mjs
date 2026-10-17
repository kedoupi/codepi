import { build } from "esbuild";

await build({
  entryPoints: ["web/src/preview-session.ts"],
  outfile: "dist/assets/preview-session.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
});
