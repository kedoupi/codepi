import type { Env as ProjectEnv } from "../worker/types";
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env extends ProjectEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
