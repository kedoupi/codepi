import { argumentError } from "./errors.js";
import { mcpEndpoint, normalizeServer } from "./server.js";

export const CONNECT_TOOLS = [
  "codex",
  "claude-code",
  "cursor",
  "vscode",
  "gemini",
  "stdio",
  "chatgpt",
  "claude-app",
] as const;

export type ConnectTool = (typeof CONNECT_TOOLS)[number];

const templates: Record<ConnectTool, (endpoint: string) => string> = {
  codex: (endpoint) => `# ~/.codex/config.toml
[mcp_servers.codepi]
url = "${endpoint}"

# Or:
# codex mcp add codepi --url ${endpoint}`,
  "claude-code": (endpoint) => `claude mcp add --transport http codepi ${endpoint}`,
  cursor: (endpoint) => `.cursor/mcp.json:
{
  "mcpServers": {
    "codepi": {
      "url": "${endpoint}"
    }
  }
}`,
  vscode: (endpoint) => `.vscode/mcp.json:
{
  "servers": {
    "codepi": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`,
  gemini: (endpoint) => `~/.gemini/settings.json:
{
  "mcpServers": {
    "codepi": {
      "httpUrl": "${endpoint}"
    }
  }
}`,
  stdio: (endpoint) => `npx -y mcp-remote ${endpoint}`,
  chatgpt: (endpoint) => `在 ChatGPT 设置中添加自定义连接器（Developer mode / Connectors），服务器 URL：
${endpoint}

该入口是否可用取决于账号套餐与客户端版本；codepi 不修改客户端配置。`,
  "claude-app": (endpoint) => `在 Claude 桌面/网页版的 Connectors 设置中添加自定义连接器：
${endpoint}

该入口是否可用取决于账号套餐与客户端版本；codepi 不修改客户端配置。`,
};

export function connectSnippet(tool: string, server: string): string {
  if (!CONNECT_TOOLS.includes(tool as ConnectTool)) {
    throw argumentError(`不支持的 connect 目标：${tool}。可选：${CONNECT_TOOLS.join(", ")}`);
  }
  return templates[tool as ConnectTool](mcpEndpoint(normalizeServer(server)));
}
