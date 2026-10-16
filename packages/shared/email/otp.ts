import { PRODUCT_BRAND } from "../brand";

export const OTP_SUBJECT = `${PRODUCT_BRAND} 登录验证码`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

// Keep the verified sender address while replacing legacy display names.
export function brandedSender(configured: string): string {
  const value = configured.trim();
  const address = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  if (/[\r\n]/.test(value) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
    throw new Error("invalid_mail_sender");
  }
  return `${PRODUCT_BRAND} <${address}>`;
}

export function buildOtpEmail(code: string, purpose = "统一登录") {
  const text = [
    PRODUCT_BRAND, purpose, "", `您的验证码是 ${code}`, "8 分钟内有效。",
    "请回到发起登录的页面输入验证码。请勿向他人提供验证码。",
    "", "若非本人操作请忽略此邮件。", "", `${PRODUCT_BRAND} · 你的个人工作空间`,
  ].join("\n");
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${OTP_SUBJECT}</title></head>
<body style="margin:0;padding:0;background:#f5f3eb;color:#1d302c;font-family:Georgia,'Noto Serif SC',serif;">
<div style="display:none;max-height:0;overflow:hidden;">${PRODUCT_BRAND} 登录验证，8 分钟内有效。</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3eb;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 8px 24px;font-size:20px;font-weight:bold;color:#275b46;">${PRODUCT_BRAND}</td></tr>
<tr><td style="padding:28px 24px;background:#fffdf7;border:1px solid #d6ddd5;border-radius:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-size:12px;line-height:1.6;color:#62716a;">${escapeHtml(purpose)}</td></tr>
<tr><td style="padding:12px 0 8px;font-size:28px;font-weight:bold;line-height:1.4;">欢迎回来。</td></tr>
<tr><td style="font-size:15px;line-height:1.8;color:#62716a;">请回到发起登录的页面，输入以下验证码。</td></tr>
<tr><td align="center" style="padding:24px 0;font:700 32px/1.5 'Courier New',monospace;letter-spacing:6px;color:#275b46;">${escapeHtml(code)}</td></tr>
<tr><td style="padding-bottom:24px;font-size:14px;line-height:1.8;color:#62716a;">8 分钟内有效。请勿向他人提供验证码。</td></tr>
<tr><td style="padding-top:20px;border-top:1px solid #d6ddd5;font-size:12px;line-height:1.8;color:#62716a;">若非本人操作请忽略此邮件。</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:24px 8px;font-size:12px;line-height:1.8;color:#62716a;">${PRODUCT_BRAND} · 你的个人工作空间</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: OTP_SUBJECT, text, html };
}
