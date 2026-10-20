import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
export default defineConfig({ test: { projects: [
  { plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.toml" }, miniflare: {
    bindings: { TEST_MIGRATIONS: migrations, ENVIRONMENT: "test", SSO_ENABLED: "1", AUTH_CLIENT_ID: "me" },
  } })], test: { name: "worker", include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] } },
  { plugins: [(await import("@sveltejs/vite-plugin-svelte")).svelte()], resolve: { conditions: ["browser"] },
    test: { name: "web", include: ["web/test/**/*.test.ts"], environment: "jsdom" } },
] } });
