import path from "node:path";
import { defineConfig } from "vitest/config";
import { defineWorkersProject, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  test: {
    projects: [
      // Worker + D1：沿用 workers 池，含现有契约测试。
      await defineWorkersProject({
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
          poolOptions: {
            workers: {
              wrangler: { configPath: "./wrangler.test.toml" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  SESSION_SECRET: "test-session-secret",
                  OTP_PEPPER: "test-otp-pepper",
                  ALLOWLIST: "owner@example.test",
                  OTP_FROM: "otp@kdp.cool",
                  ACCOUNT_BRAND: "珂抖屁",
                  ENVIRONMENT: "test",
                },
              },
            },
          },
        },
      }),
      {
        // 前端组件：jsdom + Svelte 插件，直接挂载真实 App。
        plugins: [(await import("@sveltejs/vite-plugin-svelte")).svelte()],
        resolve: {
          // jsdom 下必须走浏览器构建，否则 svelte 解析到 index-server.js。
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
