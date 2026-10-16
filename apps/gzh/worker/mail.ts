import { brandedSender, buildOtpEmail } from "@kedoupi/shared/email/otp";

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
}

export function buildOtpText(code: string): string {
  return buildOtpEmail(code, "发稿台").text;
}

export function buildOtpHtml(code: string): string {
  return buildOtpEmail(code, "发稿台").html;
}

export function createMailer(env: Env): Mailer {
  return {
    async sendOtp(to, code) {
      if (!env.RESEND_API_KEY) {
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
          from: brandedSender(from),
          to: [to],
          ...buildOtpEmail(code, "发稿台"),
        }),
      });

      if (!res.ok) {
        await res.body?.cancel();
        throw new Error("send_failed");
      }
    },
  };
}

export function exposeDevOtp(env: Env): boolean {
  return !env.RESEND_API_KEY && (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test");
}
