import { PRODUCT_BRAND } from "@kedoupi/shared/brand";
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildOtpHtml, buildOtpText, createMailer } from "../worker/mail";

describe("otp mail bodies", () => {
  it("builds plain text with title, code, ttl, and footer", () => {
    const text = buildOtpText("024359");
    expect(text).toContain("发稿台");
    expect(text).toContain("024359");
    expect(text).toContain("8 分钟内有效");
    expect(text).toContain("若非本人操作请忽略");
  });

  it("builds table HTML with inline styles and no external assets", () => {
    const html = buildOtpHtml("024359");
    expect(html).toContain("<table");
    expect(html).toContain("发稿台");
    expect(html).toContain("024359");
    expect(html).toContain("monospace");
    expect(html).toContain("8 分钟内有效");
    expect(html).toContain("若非本人操作请忽略");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/stylesheet/i);
  });
});

describe("createMailer Resend payload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs both html and text with the fixed subject", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const mailer = createMailer({
      RESEND_API_KEY: "re_test",
      OTP_FROM: "otp@kdp.cool",
    } as Env);

    await mailer.sendOtp("kedoupi@gmail.com", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(body.from).toBe(`${PRODUCT_BRAND} <otp@kdp.cool>`);
    expect(body.to).toEqual(["kedoupi@gmail.com"]);
    expect(body.subject).toBe(`${PRODUCT_BRAND} 登录验证码`);
    expect(body.text).toBe(buildOtpText("123456"));
    expect(body.html).toBe(buildOtpHtml("123456"));
    expect(body.html).toContain("123456");
  });
});
