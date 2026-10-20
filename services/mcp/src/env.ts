import type { SsoEnv } from "@kedoupi/shared/auth/client";
import type { HealthService, ProjectService, MeService, GuService } from "@kedoupi/shared/mcp/contract";

export interface Env extends SsoEnv {
  MCP_ORIGIN: string;
  MCP_ALLOWED_ORIGINS?: string;
  HEALTH: HealthService;
  PROJECT: ProjectService;
  ME: MeService;
  GU: GuService;
  BUILD_SHA?: string;
}
