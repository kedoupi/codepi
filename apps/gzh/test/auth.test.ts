import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALLOWED, loginAsAllowlisted, requestOtp, verifyOtp } from "./helpers";

describe("otp + session", () => {
  it("returns a generic message for unknown emails and does not leak membership", async () => {
    const res = await requestOtp("stranger@example.com");
    const body = (await res.json()) as { ok: boolean; message: string; dev_otp?: string };
    expect(res.status).toBe(200);
    expect(body.message).toContain("若在名单内");
    expect(body.dev_otp).toBeUndefined();
  });

  it("issues a 6-digit OTP for the allowlist and sets gzh_session on verify", async () => {
    const req = await requestOtp(ALLOWED, "8.8.8.8");
    const issued = (await req.json()) as { dev_otp?: string };
    expect(req.status).toBe(200);
    expect(issued.dev_otp).toMatch(/^\d{6}$/);

    const verified = await verifyOtp(ALLOWED, issued.dev_otp!);
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("gzh_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");

    const me = await SELF.fetch("https://gzh.codepi.app/api/me", {
      headers: { Cookie: cookie.split(";")[0] },
    });
    const meBody = (await me.json()) as { account: { email: string; brand: string } };
    expect(me.status).toBe(200);
    expect(meBody.account.email).toBe(ALLOWED);
    expect(meBody.account.brand).toBe("珂抖屁");
  });

  it("rejects a wrong code and voids the OTP after 5 failures", async () => {
    const req = await requestOtp(ALLOWED, "9.9.9.9");
    const issued = (await req.json()) as { dev_otp?: string };
    expect(issued.dev_otp).toBeTruthy();

    for (let i = 0; i < 5; i += 1) {
      const fail = await verifyOtp(ALLOWED, "000000");
      expect(fail.status).toBe(400);
    }

    const late = await verifyOtp(ALLOWED, issued.dev_otp!);
    expect(late.status).toBe(400);
  });

  it("rate-limits a second OTP within 60 seconds for the same email", async () => {
    const first = await requestOtp(ALLOWED, "4.4.4.4");
    const firstBody = (await first.json()) as { dev_otp?: string };
    expect(firstBody.dev_otp).toMatch(/^\d{6}$/);

    const second = await requestOtp(ALLOWED, "4.4.4.4");
    const secondBody = (await second.json()) as { dev_otp?: string };
    expect(second.status).toBe(200);
    expect(secondBody.dev_otp).toBeUndefined();
  });
});

describe("page gate", () => {
  it("redirects the desk and preview shell to /login without a session", async () => {
    const desk = await SELF.fetch("https://gzh.codepi.app/", { redirect: "manual" });
    expect(desk.status).toBe(302);
    expect(desk.headers.get("Location")).toContain("/login");

    const preview = await SELF.fetch("https://gzh.codepi.app/p/kdp-0917-zao/", { redirect: "manual" });
    expect(preview.status).toBe(302);
    expect(preview.headers.get("Location")).toContain("/login");

    const article = await SELF.fetch("https://gzh.codepi.app/previews/kdp-0917-zao/", { redirect: "manual" });
    expect(article.status).toBe(302);
    expect(article.headers.get("Location")).toContain("/login");
  });

  it("lets a session through the /previews login gate (HTML 或测试无 ASSETS 时的 404)", async () => {
    const cookie = await loginAsAllowlisted();
    const res = await SELF.fetch("https://gzh.codepi.app/previews/kdp-0917-zao/", {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(res.status).not.toBe(302);
    expect(res.status).not.toBe(401);
  });

  it("keeps /login public", async () => {
    const res = await SELF.fetch("https://gzh.codepi.app/login", { redirect: "manual" });
    expect(res.status).not.toBe(302);
  });

  it("returns 401 for board without a session", async () => {
    const res = await SELF.fetch("https://gzh.codepi.app/api/board");
    expect(res.status).toBe(401);
  });

  it("lets a session reach /api/board", async () => {
    const cookie = await loginAsAllowlisted();
    const res = await SELF.fetch("https://gzh.codepi.app/api/board?date=2026-09-17", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
