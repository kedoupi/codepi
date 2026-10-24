import { SELF } from "cloudflare:test";

export const ALLOWED = "owner@example.test";

export async function requestOtp(email: string, ip = "1.1.1.1") {
  return SELF.fetch("https://gzh.codepi.app/api/auth/request-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://gzh.codepi.app",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ email }),
  });
}

export async function verifyOtp(email: string, code: string) {
  return SELF.fetch("https://gzh.codepi.app/api/auth/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://gzh.codepi.app" },
    body: JSON.stringify({ email, code }),
  });
}

export async function loginAsAllowlisted() {
  const otpRes = await requestOtp(ALLOWED);
  const otpBody = (await otpRes.json()) as { dev_otp?: string };
  if (!otpBody.dev_otp) {
    throw new Error("test expected dev_otp");
  }
  const verifyRes = await verifyOtp(ALLOWED, otpBody.dev_otp);
  const cookie = verifyRes.headers.get("Set-Cookie");
  if (!cookie) throw new Error("missing session cookie");
  return cookie.split(";")[0];
}

export function authed(cookie: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  headers.set("Origin", "https://gzh.codepi.app");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return SELF.fetch(`https://gzh.codepi.app${path}`, { ...init, headers });
}
