export interface FeishuChannelEnv {
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_RECEIVE_OPEN_ID?: string;
}

export interface FeishuError extends Error {
  code: string;
  retryable: boolean;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TokenCacheEntry = { token: string; expiresAt: number };

const tokenCache = new Map<string, TokenCacheEntry>();
let fetchOverride: FetchLike | undefined;
const RETRYABLE_CODES = new Set(["99991663", "99991400", "230020"]);
const PERMANENT_CODES = new Set(["230013", "230053", "99991543", "99991672", "99991401", "230006", "230025", "230099"]);
const TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const MESSAGE_URL = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id";

function coded(code: string, retryable: boolean): FeishuError {
  return Object.assign(new Error(code), { name: "FeishuError", code, retryable });
}

function httpError(status: number): FeishuError {
  return coded(`E_FEISHU_HTTP_${status}`, status === 429 || status >= 500);
}

function networkError(): FeishuError {
  return coded("E_FEISHU_NETWORK", true);
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  try {
    const value = await response.json() as unknown;
    return value && typeof value === "object" ? value as Record<string, any> : {};
  } catch {
    return {};
  }
}

async function request(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw networkError();
  }
  const result = await responseJson(response);
  const code = String(result.code ?? "");
  if (!response.ok && code && code !== "0") return result;
  if (!response.ok) throw httpError(response.status);
  return result;
}

async function getToken(env: FeishuChannelEnv, fetchImpl: FetchLike, refresh = false) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw coded("E_FEISHU_NOT_CONFIGURED", false);
  const cached = tokenCache.get(appId);
  if (!refresh && cached && cached.expiresAt - Date.now() >= 30 * 60 * 1000) return cached.token;
  const result = await request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  }, fetchImpl);
  const code = String(result.code ?? "0");
  if (code !== "0") throw coded(`E_FEISHU_${code}`, RETRYABLE_CODES.has(code));
  const token = typeof result.tenant_access_token === "string" ? result.tenant_access_token : "";
  if (!token) throw coded("E_FEISHU_INVALID_RESPONSE", false);
  const expiresIn = Number(result.expire ?? 7200);
  tokenCache.set(appId, { token, expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 7200) * 1000 });
  return token;
}

async function sendMessage(env: FeishuChannelEnv, card: unknown, uuid: string, fetchImpl: FetchLike, token: string) {
  const result = await request(MESSAGE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ receive_id: env.FEISHU_RECEIVE_OPEN_ID, msg_type: "interactive", content: JSON.stringify(card), uuid }),
  }, fetchImpl);
  const code = String(result.code ?? "0");
  if (code !== "0") throw coded(`E_FEISHU_${code}`, RETRYABLE_CODES.has(code) && !PERMANENT_CODES.has(code));
  const messageId = result.data?.message_id ?? result.message_id;
  if (typeof messageId !== "string" || !messageId) throw coded("E_FEISHU_INVALID_RESPONSE", false);
  return messageId;
}

export function resetFeishuTokenCache() {
  tokenCache.clear();
}

export function setFeishuFetchForTest(fetchImpl?: FetchLike) {
  fetchOverride = fetchImpl;
}

export const __resetFeishuTokenCache = resetFeishuTokenCache;

export async function sendFeishu(env: FeishuChannelEnv, card: unknown, uuid: string, fetchImpl: FetchLike = fetchOverride ?? fetch) {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_RECEIVE_OPEN_ID) throw coded("E_FEISHU_NOT_CONFIGURED", false);
  let token: string;
  try {
    token = await getToken(env, fetchImpl);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && String(error.code) === "E_FEISHU_99991663")) throw error;
    token = await getToken(env, fetchImpl, true);
  }
  try {
    return await sendMessage(env, card, uuid, fetchImpl, token);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && String(error.code) === "E_FEISHU_99991663")) throw error;
    const appId = env.FEISHU_APP_ID;
    tokenCache.delete(appId);
    token = await getToken(env, fetchImpl, true);
    return sendMessage(env, card, uuid, fetchImpl, token);
  }
}
