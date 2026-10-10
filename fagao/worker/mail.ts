export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
}

/** Plain-text OTP body (also used as Resend `text`). */
export function buildOtpText(code: string): string {
  return [
    "发稿台",
    "",
    `您的验证码是 ${code}`,
    "8 分钟内有效。",
    "",
    "若非本人操作请忽略。",
  ].join("\n");
}

/** Table + inline-style HTML for Resend `html` (no images / external CSS / links). */
export function buildOtpHtml(code: string): string {
  const safe = escapeHtml(code);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4;">
          <tr>
            <td style="padding:28px 28px 8px 28px;font-size:18px;font-weight:600;color:#1c1917;letter-spacing:0.02em;">发稿台</td>
          </tr>
          <tr>
            <td style="padding:8px 28px 4px 28px;font-size:14px;line-height:1.5;color:#57534e;">您的验证码是</td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 28px 8px 28px;font-size:36px;line-height:1.2;font-weight:700;letter-spacing:0.28em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;color:#1c1917;">${safe}</td>
          </tr>
          <tr>
            <td style="padding:4px 28px 8px 28px;font-size:14px;line-height:1.5;color:#57534e;">8 分钟内有效。</td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px 28px;font-size:12px;line-height:1.5;color:#a8a29e;border-top:1px solid #f5f5f4;">若非本人操作请忽略</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createMailer(env: Env): Mailer {
  return {
    async sendOtp(to, code) {
      if (!env.RESEND_API_KEY) {
        console.log(`[fagao-otp] ${to} ${code}`);
        return;
      }

      const from = env.OTP_FROM?.trim() || "otp@kdp.cool";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "发稿台验证码",
          text: buildOtpText(code),
          html: buildOtpHtml(code),
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        console.error("[fagao-otp] resend failed", res.status, detail.slice(0, 300));
        throw new Error("send_failed");
      }
    },
  };
}

export function exposeDevOtp(env: Env): boolean {
  return !env.RESEND_API_KEY && (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test");
}
