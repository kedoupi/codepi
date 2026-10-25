import type { SsoEnv } from "@kedoupi/shared/auth/client";
import type { HealthService, ProjectService, MeService, GuService, BlogService } from "@kedoupi/shared/mcp/contract";
export interface Env extends SsoEnv {
  MCP_ORIGIN: string;
  MCP_ALLOWED_ORIGINS?: string;
  LEGACY_SSE: DurableObjectNamespace;
  HEALTH: HealthService;
  PROJECT: ProjectService;
  ME: MeService;
  GU: GuService;
  BLOG: BlogService;
  BUILD_SHA?: string;
}
