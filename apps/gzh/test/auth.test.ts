import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleRequestOtp } from "../worker/auth";
import { api } from "../worker/app";
import { shanghaiDate, sameOrigin as checkSameOrigin } from "../worker/lib";
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

  it("allows only one session when the correct OTP is verified concurrently", async () => {
    await env.DB.prepare("DELETE FROM sessions").run();
    const req = await requestOtp(ALLOWED, "6.6.6.6");
    const issued = (await req.json()) as { dev_otp?: string };
    expect(issued.dev_otp).toMatch(/^\d{6}$/);
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();

    const results = await Promise.all([
      verifyOtp(ALLOWED, issued.dev_otp!),
      verifyOtp(ALLOWED, issued.dev_otp!),
    ]);

    expect(results.map((response) => response.status).sort()).toEqual([200, 400]);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
  });

  it("enforces the five-attempt limit when invalid verifications race", async () => {
    const req = await requestOtp(ALLOWED, "7.7.7.7");
    const issued = (await req.json()) as { dev_otp?: string };
    expect(issued.dev_otp).toMatch(/^\d{6}$/);

    const failures = await Promise.all(
      Array.from({ length: 8 }, () => verifyOtp(ALLOWED, "000000")),
    );
    expect(failures.every((response) => response.status === 400)).toBe(true);

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
  it("marks an inserted OTP used when mail delivery fails", async () => {
    await env.DB.prepare("DELETE FROM otp_codes WHERE email = ?").bind(ALLOWED).run();
    const request = new Request("https://gzh.codepi.app/api/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "9.9.9.9" },
      body: JSON.stringify({ email: ALLOWED }),
    });

    const response = await handleRequestOtp(request, env, {
      sendOtp: async () => {
        throw new Error("send_failed");
      },
    });

    expect(response.status).toBe(502);
    const row = await env.DB.prepare(
      "SELECT used_at FROM otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(ALLOWED)
      .first<{ used_at: string | null }>();
    expect(row?.used_at).not.toBeNull();
  });
});

describe("write origin gate", () => {
  it("rejects authenticated writes without Origin while preserving same-origin and GET access", async () => {
    const noOriginRequest = { headers: { get: () => null }, url: "https://gzh.codepi.app/posts" } as unknown as Request;
    expect(checkSameOrigin(noOriginRequest)).toBe(false);
    const cookie = await loginAsAllowlisted();
    const callApi = (path: string, init: RequestInit = {}) => {
      const request = new Request(`https://gzh.codepi.app${path}`, init);
      if (!new Headers(init.headers).has("Origin")) request.headers.set("Origin", "");
      return api.fetch(request, env);
    };
    const noOriginPost = await callApi("/posts", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noOriginPost.status).toBe(403);
    const noOriginPatch = await callApi("/posts/missing", {
      method: "PATCH",
      headers: { Cookie: cookie, Origin: "", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noOriginPatch.status).toBe(403);
    const noOriginLogout = await callApi("/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "" },
    });
    expect(noOriginLogout.status).toBe(403);
    const sameOriginResponse = await callApi("/board?date=2026-09-17", {
      headers: { Cookie: cookie, Origin: "https://gzh.codepi.app" },
    });
    expect(sameOriginResponse.status).toBe(200);
    const crossOrigin = await callApi("/posts", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(crossOrigin.status).toBe(403);
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
  it("does not run the board GET handler for an authenticated HEAD", async () => {
    const cookie = await loginAsAllowlisted();
    const date = shanghaiDate();
    const beforePosts = await env.DB.prepare("SELECT id, publish_date FROM posts ORDER BY id").all();
    const beforeMeta = await env.DB.prepare("SELECT key, value FROM desk_meta ORDER BY key").all();

    const res = await SELF.fetch(`https://gzh.codepi.app/api/board?date=${date}`, {
      method: "HEAD",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(404);
    expect(await env.DB.prepare("SELECT id, publish_date FROM posts ORDER BY id").all()).toEqual(beforePosts);
    expect(await env.DB.prepare("SELECT key, value FROM desk_meta ORDER BY key").all()).toEqual(beforeMeta);
  });
});
