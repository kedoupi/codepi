import type { SsoEnv } from "@kedoupi/shared/auth/client";
import type { HealthService } from "@kedoupi/shared/mcp/contract";

export interface Env extends SsoEnv {
  MCP_ORIGIN: string;
  MCP_ALLOWED_ORIGINS?: string;
  HEALTH: HealthService;
  BUILD_SHA?: string;
}
