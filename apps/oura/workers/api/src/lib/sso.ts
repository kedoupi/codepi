import { SsoError, ssoEnabled } from "@kedoupi/shared/auth/client";
import type { Env } from "../env";

export { beginLogin, finishLogin, logoutSso, readSsoSession, SsoError, ssoEnabled } from "@kedoupi/shared/auth/client";

export function personalOwner(env: Env): string {
  if (!env.PERSONAL_OWNER_ID || env.PERSONAL_OWNER_ID === "dev-local") {
    throw new SsoError("owner_not_configured", 503);
  }
  if (ssoEnabled(env) && env.AUTH_CLIENT_ID !== "oura") {
    throw new SsoError("auth_not_configured", 503);
  }
  return env.PERSONAL_OWNER_ID;
}
