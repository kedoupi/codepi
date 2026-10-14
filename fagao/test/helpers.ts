import { SELF } from "cloudflare:test";

export const ALLOWED = "kedoupi@gmail.com";

export async function requestOtp(email: string, ip = "1.1.1.1") {
  return SELF.fetch("https://fagao.kdp.cool/api/auth/request-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, code: string) {
  return SELF.fetch("https://fagao.kdp.cool/api/auth/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}

export const EDITOR = "editor@example.com";

export async function loginAsAllowlisted() {
  return loginAs(ALLOWED);
}

export async function loginAs(email: string) {
  const otpRes = await requestOtp(email);
  const otpBody = (await otpRes.json()) as { dev_otp?: string };
  if (!otpBody.dev_otp) {
    throw new Error("test expected dev_otp");
  }
  const verifyRes = await verifyOtp(email, otpBody.dev_otp);
  const cookie = verifyRes.headers.get("Set-Cookie");
  if (!cookie) throw new Error("missing session cookie");
  return cookie.split(";")[0];
}

export function authed(cookie: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return SELF.fetch(`https://fagao.kdp.cool${path}`, { ...init, headers });
}

export const SUBMIT_TOKEN = "test-submit-token-0123456789abcdef";

export function bot(path: string, init: RequestInit = {}, token = SUBMIT_TOKEN) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`https://fagao.kdp.cool${path}`, { ...init, headers });
}
