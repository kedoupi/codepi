/** Public client metadata only. Credentials remain in the Auth/runtime secret stores. */
export const SSO_CLIENTS = {
  gu: { secret: "SSO_CLIENT_SECRET_GU" },
  oura: { secret: "SSO_CLIENT_SECRET_OURA", displayName: "健康 Health" },
  gzh: { secret: "SSO_CLIENT_SECRET_GZH", displayName: "公众号 GZH" },
  desk: { secret: "SSO_CLIENT_SECRET_DESK" },
  mcp: { secret: "SSO_CLIENT_SECRET_MCP", displayName: "CodePi MCP", callback: "https://mcp.codepi.app/api/auth/callback" },
  project: { secret: "SSO_CLIENT_SECRET_PROJECT", displayName: "CodePi Project", callback: "https://project.codepi.app/api/auth/callback" },
  me: { secret: "SSO_CLIENT_SECRET_ME", displayName: "CodePi Me", callback: "https://me.codepi.app/api/auth/callback" },
} as const;
export type SsoClientId = keyof typeof SSO_CLIENTS;
export function isSsoClientId(value: string): value is SsoClientId {
  return Object.hasOwn(SSO_CLIENTS, value);
}
