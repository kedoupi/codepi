import { buildNotificationEmail, notificationSender, type NotificationEmailInput } from "@kedoupi/shared/email/notification";

export interface EmailChannelEnv {
  EMAIL: { send(message: Record<string, unknown>): Promise<{ messageId?: string; id?: string } | void> };
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
}

export async function sendEmail(env: EmailChannelEnv, input: NotificationEmailInput) {
  if (!env.NOTIFY_TO) throw Object.assign(new Error("E_RECIPIENT_NOT_ALLOWED"), { code: "E_RECIPIENT_NOT_ALLOWED" });
  const email = buildNotificationEmail(input);
  const result = await env.EMAIL.send({ to: env.NOTIFY_TO, from: notificationSender(env.NOTIFY_FROM), subject: email.subject, text: email.text, html: email.html });
  return result?.messageId ?? result?.id;
}
