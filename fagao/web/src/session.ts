let version = 0;
let controller = new AbortController();
let onExpired = () => {};
const responseVersions = new WeakMap<Response, number>();

export class SessionExpiredError extends Error {
  constructor() { super("登录已过期，请重新登录"); }
}

export const sessionVersion = () => version;
export const isSessionCurrent = (value: number) => value === version;
export function onSessionExpired(callback: () => void) { onExpired = callback; }

export function expireSession() {
  version++;
  controller.abort();
  controller = new AbortController();
  onExpired();
}

export function assertResponseSession(response: Response) {
  if (responseVersions.get(response) !== version) throw new SessionExpiredError();
}

export async function sessionFetch(input: string, init?: RequestInit): Promise<Response> {
  const current = version;
  const response = await fetch(input, {
    ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal,
  });
  if (!isSessionCurrent(current)) throw new SessionExpiredError();
  if (response.status === 401) {
    expireSession();
    throw new SessionExpiredError();
  }
  responseVersions.set(response, current);
  return response;
}
