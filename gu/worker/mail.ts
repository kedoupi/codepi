export function otpEmail(code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("Invalid OTP format");
  return {
    text: `珂抖屁 · 投资\n\n您的验证码是 ${code}\n8 分钟内有效。请勿向他人提供验证码。\n\n若非本人操作，请忽略。`,
    // Match Oura's warm canvas, orange accent and rounded cards without remote assets.
    html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>投资看板登录验证码</title>
</head>
<body style="margin:0;padding:0;background:#fffaf5;color:#0f172a;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">投资看板登录验证，8 分钟内有效。</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding:0 8px 20px;font-size:14px;font-weight:600;color:#9a3412;">珂抖屁 · 投资</td></tr>
        <tr><td style="padding:28px 24px;background:#ffffff;border:1px solid #edd5c4;border-top:4px solid #f97316;border-radius:14px;">
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.4;">登录您的投资看板</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#475569;">请在登录页面输入以下验证码：</p>
          <div style="padding:20px 8px;background:#fff7ed;border:1px solid #edd5c4;border-radius:10px;text-align:center;">
            <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:bold;letter-spacing:6px;color:#9a3412;white-space:nowrap;">${code}</span>
          </div>
          <p style="margin:20px 0 0;font-size:14px;line-height:1.8;"><strong>8 分钟内有效，仅可使用一次。</strong><br>请勿向他人提供验证码。</p>
        </td></tr>
        <tr><td style="padding:20px 8px 0;font-size:13px;line-height:1.8;color:#64748b;">若非本人操作，请忽略此邮件。<br>此邮件由投资看板自动发送，无需回复。</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
