import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({
          wrangler: { configPath: "./wrangler.test.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ENVIRONMENT: "test",
              SSO_ENABLED: "1",
              AUTH_CLIENT_ID: process.env.PROJECT_TEST_AUTH_CLIENT_ID || "project",
              AUTH_CLIENT_SECRET: "test-project-sso-secret-not-for-production",
              AUTH_ORIGIN: "https://auth.codepi.app",
              PROJECT_ORIGIN: "https://project.codepi.app",
              PROJECT_REPOS: "kedoupi/codepi",
              BUILD_SHA: "test",
            },
          },
        })],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        plugins: [(await import("@sveltejs/vite-plugin-svelte")).svelte()],
        resolve: {
          conditions: ["browser"],
        },
        test: {
          name: "web",
          include: ["web/test/**/*.test.ts"],
          environment: "jsdom",
        },
      },
    ],
  },
});
