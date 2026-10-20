import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, afterEach, vi } from "vitest";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
beforeEach(async () => {
  // Isolated synthetic fixtures; the application never removes append-only rows.
  for (const table of ["memories", "profile", "profile_proposals", "timeline", "imports", "import_chunks", "import_sessions", "kdp_sso_sessions", "kdp_sso_transactions"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const files = await env.IMPORTS.list();
  if (files.objects.length) await env.IMPORTS.delete(files.objects.map(row => row.key));
});
afterEach(() => vi.restoreAllMocks());
