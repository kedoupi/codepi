import type { Env as GuEnv } from "../worker/types";
import type { D1Migration } from "@cloudflare/vitest-plugin";
declare global {
  namespace Cloudflare {
    interface Env extends GuEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
