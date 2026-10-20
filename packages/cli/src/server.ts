import { argumentError } from "./errors.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function normalizeServer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw argumentError(`无效的 server 地址：${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw argumentError("server 地址不能包含凭证、查询参数或片段");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw argumentError("server 必须使用 HTTPS；仅 loopback 开发服务器允许 HTTP");
  }
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function mcpEndpoint(server: string): string {
  return `${normalizeServer(server)}/mcp`;
}

export function protectedResourceMetadataUrl(server: string): string {
  return `${normalizeServer(server)}/.well-known/oauth-protected-resource/mcp`;
}

export function authorizationMetadataUrl(server: string): string {
  return `${normalizeServer(server)}/.well-known/oauth-authorization-server`;
}

export function assertTrustedUrl(value: string, server: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  const trusted = new URL(normalizeServer(server));
  if (url.origin !== trusted.origin || url.username || url.password || url.hash) {
    throw new Error(`${label} 的 origin 与受信任 server 不一致`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`${label} 必须使用 HTTPS`);
  }
  return url;
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
