import type { Env as MeEnv } from "../worker/types";
import type { D1Migration } from "@cloudflare/vitest-plugin";
declare global {
  namespace Cloudflare { interface Env extends MeEnv { TEST_MIGRATIONS: D1Migration[]; } }
}
