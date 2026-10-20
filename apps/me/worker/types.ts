import type { SsoEnv } from "@kedoupi/shared/auth/client";

export interface Env extends SsoEnv {
  DB: D1Database;
  IMPORTS: R2Bucket;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  BUILD_SHA?: string;
}
