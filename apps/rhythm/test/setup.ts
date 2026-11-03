import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeEach, vi } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  // Isolated synthetic settings; the application only reads this table.
  await env.DB.prepare("DELETE FROM settings").run();
  await env.DB.prepare("DELETE FROM kdp_sso_sessions").run();
  await env.DB.prepare("DELETE FROM kdp_sso_transactions").run();
});

afterEach(() => vi.restoreAllMocks());
