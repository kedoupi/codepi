import type { Env as RhythmEnv } from "../worker/types";
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env extends RhythmEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
