import { PRODUCT_BRAND } from "../brand";
import { brandedSender } from "./otp";
import type { NotifyEvent, NotifySeverity } from "../notify/contract";

export interface NotificationEmailInput {
  event: NotifyEvent;
  duration?: string;
  firstSeen?: string;
  lastSeen?: string;
  incidentId?: string;
  reason?: string;
  count?: number;
  digest?: boolean;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const severityLabel: Record<NotifySeverity, string> = { critical: "严重", warning: "注意", info: "通知" };

function prefix(input: NotificationEmailInput) {
  const { event } = input;
  if (event.state === "resolved") return "[恢复]";
  if (event.kind === "notify.selftest") return "[自检]";
  return `[${severityLabel[event.severity]}]`;
}

const DEFAULT_NOTIFICATION_SENDER = ["notify", "@", "notify.codepi.app"].join("");
export function notificationSender(configured = DEFAULT_NOTIFICATION_SENDER) {
  return brandedSender(configured);
}

export function buildNotificationEmail(input: NotificationEmailInput) {
  const { event } = input;
  const facts = event.facts ?? [];
  const subject = `${prefix(input)} ${event.title}`.trim().slice(0, 180);
  const conclusion = event.state === "resolved" ? `${event.title}，问题已经恢复。` : event.summary || event.title;
  const rows = facts.map(fact => `${fact.label}: ${fact.value}`);
  const text = [
    PRODUCT_BRAND,
    subject,
    "",
    conclusion,
    ...rows,
    "",
    `开始时间：${input.firstSeen ?? event.occurred_at}`,
    `最近一次观察：${input.lastSeen ?? event.occurred_at}`,
    ...(input.duration ? [`持续时长：${input.duration}`] : []),
    ...(event.link ? ["", `查看详情：${event.link}`] : []),
    "",
    `来源：${event.source}`,
    ...(input.incidentId ? [`事故编号：${input.incidentId}`] : []),
    `为什么收到这封邮件：${input.reason ?? "这是统一通知服务根据事件规则生成的提醒。"}`,
    "",
    `${PRODUCT_BRAND} · 你的个人工作空间`,
  ].join("\n");
  const factRows = facts.map(fact => `<tr><td style="padding:8px 0;border-bottom:1px solid #d6ddd5;color:#62716a;">${escapeHtml(fact.label)}</td><td style="padding:8px 0;border-bottom:1px solid #d6ddd5;text-align:right;">${escapeHtml(fact.value)}</td></tr>`).join("");
  const detail = event.link ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(event.link)}" style="color:#275b46;">查看详情</a></p>` : "";
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f3eb;color:#1d302c;font-family:Georgia,'Noto Serif SC',serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="padding:0 8px 24px;font-size:20px;font-weight:bold;color:#275b46;">${escapeHtml(PRODUCT_BRAND)}</td></tr><tr><td style="padding:28px 24px;background:#fffdf7;border:1px solid #d6ddd5;border-radius:16px;"><p style="margin:0 0 12px;font-size:12px;color:#62716a;">${escapeHtml(subject)}</p><h1 style="margin:0 0 12px;font-size:24px;line-height:1.4;">${escapeHtml(conclusion)}</h1>${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows}</table>` : ""}<p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#62716a;">开始时间：${escapeHtml(input.firstSeen ?? event.occurred_at)}<br>最近一次观察：${escapeHtml(input.lastSeen ?? event.occurred_at)}${input.duration ? `<br>持续时长：${escapeHtml(input.duration)}` : ""}</p>${detail}<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #d6ddd5;font-size:12px;line-height:1.8;color:#62716a;">来源：${escapeHtml(event.source)}${input.incidentId ? `<br>事故编号：${escapeHtml(input.incidentId)}` : ""}<br>为什么收到这封邮件：${escapeHtml(input.reason ?? "这是统一通知服务根据事件规则生成的提醒。")}</p></td></tr><tr><td align="center" style="padding:24px 8px;font-size:12px;line-height:1.8;color:#62716a;">${escapeHtml(PRODUCT_BRAND)} · 你的个人工作空间</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
