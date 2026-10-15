import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
export default defineConfig({
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
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
