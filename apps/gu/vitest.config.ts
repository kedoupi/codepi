import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
export default defineConfig({
  test: {
    projects: [
      {
        // Worker + D1：沿用 cloudflareTest 池，含现有的 app.test.ts 全量契约。
        plugins: [cloudflareTest({
          wrangler: { configPath: "./wrangler.test.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              SESSION_SECRET: "test-session-secret-not-for-production",
              OTP_PEPPER: "test-otp-secret-not-for-production",
              UPLOAD_TOKEN: "test-upload-token-not-for-production",
              ENVIRONMENT: "test",
              OTP_FROM: "otp@kdp.cool",
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
