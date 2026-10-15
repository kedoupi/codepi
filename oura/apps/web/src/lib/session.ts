import type { MeResponse } from "./types";

/** Keep only public login options when private workspace state is discarded. */
export function loggedOutMe(previous: MeResponse | null): MeResponse {
  return {
    authenticated: false,
    source: null,
    userId: null,
    ssoEnabled: previous?.ssoEnabled === true,
    oauthConfigured: previous?.oauthConfigured === true,
    allowDevLogin: previous?.ssoEnabled !== true && previous?.allowDevLogin === true,
  };
}
