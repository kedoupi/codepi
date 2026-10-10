import path from "node:path";
import { defineWorkersProject, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineWorkersProject({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-session-secret",
            OTP_PEPPER: "test-otp-pepper",
            ALLOWLIST: "kedoupi@gmail.com",
            OTP_FROM: "otp@kdp.cool",
            ACCOUNT_BRAND: "珂抖屁",
            ENVIRONMENT: "test",
          },
        },
      },
    },
  },
});
