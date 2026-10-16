import type { SsoEnv } from "../../../../../packages/shared/auth/client";

export interface Env extends SsoEnv {
  DESK_SUMMARY_TOKEN?: string;
  OURA_CLIENT_ID?: string;
  OURA_CLIENT_SECRET?: string;
  OURA_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SESSION_SECRET?: string;
  ALLOW_DEV_LOGIN?: string;
  FRONTEND_ORIGIN?: string;
  FRONTEND_ORIGINS?: string;
  PERSONAL_OWNER_ID?: string;
  AI_ENABLED?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_DAILY_LIMIT?: string;
  BUILD_SHA?: string;
  AUTO_SYNC_ENABLED?: string;
}
