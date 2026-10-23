import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await env.DB.prepare("UPDATE accounts SET email = 'owner@example.test' WHERE id = 'acc_owner_kdp'").run();
