import type { SsoEnv } from "@kedoupi/shared/auth/client";

export interface Env extends SsoEnv {
  DB: D1Database;
  /** Read-only upstream binding; the real service name is injected at deploy time. */
  STATUS_READ: Fetcher;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  BUILD_SHA?: string;
}
