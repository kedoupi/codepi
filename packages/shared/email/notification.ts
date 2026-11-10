import { PRODUCT_BRAND } from "../brand";
import { brandedSender } from "./otp";
import type { NotifyEvent, NotifySeverity } from "../notify/contract";

export interface NotificationEmailOptions {
  event: NotifyEvent;
  duration?: string;
  firstSeen?: string;
  lastSeen?: string;
  incidentId?: string;
  reason?: string;
  count?: number;
  digest?: boolean;
}
export type NotificationEmailInput = NotificationEmailOptions | NotifyEvent;

export interface NotificationParts {
  event: NotifyEvent;
  prefix: string;
  subject: string;
  title: string;
  conclusion: string;
  facts: NotifyEvent["facts"];
  firstSeen: string;
  lastSeen: string;
  duration?: string;
  link?: string;
  source: string;
  incidentId?: string;
  reason: string;
}

export function notificationParts(input: NotificationEmailInput): NotificationParts {
  const event = "event" in input ? input.event : input;
  const options: Omit<NotificationEmailOptions, "event"> = "event" in input ? input : {};
  const prefixValue = prefix(event);
  const subject = `${prefixValue} ${event.title}`.trim().slice(0, 180);
  return {
    event,
    prefix: prefixValue,
    subject,
    title: event.title,
    conclusion: event.state === "resolved" ? `${event.title}，问题已经恢复。` : event.summary || event.title,
    facts: event.facts ?? [],
    firstSeen: options.firstSeen ?? event.occurred_at,
    lastSeen: options.lastSeen ?? event.occurred_at,
    ...(options.duration ? { duration: options.duration } : {}),
    ...(event.link ? { link: event.link } : {}),
    source: event.source,
    ...(options.incidentId ? { incidentId: options.incidentId } : {}),
    reason: options.reason ?? "这是统一通知服务根据事件规则生成的提醒。",
  };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const severityLabel: Record<NotifySeverity, string> = { critical: "严重", warning: "注意", info: "通知" };

function prefix(event: NotifyEvent) {
  if (event.state === "resolved") return "[恢复]";
  if (event.kind === "notify.selftest") return "[自检]";
  return `[${severityLabel[event.severity]}]`;
}

const DEFAULT_NOTIFICATION_SENDER = ["notify", "@", "notify.codepi.app"].join("");
export function notificationSender(configured = DEFAULT_NOTIFICATION_SENDER) {
  return brandedSender(configured);
}

export function buildNotificationEmail(input: NotificationEmailInput) {
  const { event, facts: rawFacts, subject, conclusion, firstSeen, lastSeen, duration, link, source, incidentId, reason } = notificationParts(input);
  const facts = rawFacts ?? [];
  const rows = facts.map(fact => `${fact.label}: ${fact.value}`);
  const text = [
    PRODUCT_BRAND,
    subject,
    "",
    conclusion,
    ...rows,
    "",
    `开始时间：${firstSeen}`,
    `最近一次观察：${lastSeen}`,
    ...(duration ? [`持续时长：${duration}`] : []),
    ...(link ? ["", `查看详情：${link}`] : []),
    "",
    `来源：${source}`,
    ...(incidentId ? [`事故编号：${incidentId}`] : []),
    `为什么收到这封邮件：${reason}`,
    "",
    `${PRODUCT_BRAND} · 你的个人工作空间`,
  ].join("\n");
  const factRows = facts.map(fact => `<tr><td style="padding:8px 0;border-bottom:1px solid #d6ddd5;color:#62716a;">${escapeHtml(fact.label)}</td><td style="padding:8px 0;border-bottom:1px solid #d6ddd5;text-align:right;">${escapeHtml(fact.value)}</td></tr>`).join("");
  const detail = event.link ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(event.link)}" style="color:#275b46;">查看详情</a></p>` : "";
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f3eb;color:#1d302c;font-family:Georgia,'Noto Serif SC',serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="padding:0 8px 24px;font-size:20px;font-weight:bold;color:#275b46;">${escapeHtml(PRODUCT_BRAND)}</td></tr><tr><td style="padding:28px 24px;background:#fffdf7;border:1px solid #d6ddd5;border-radius:16px;"><p style="margin:0 0 12px;font-size:12px;color:#62716a;">${escapeHtml(subject)}</p><h1 style="margin:0 0 12px;font-size:24px;line-height:1.4;">${escapeHtml(conclusion)}</h1>${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows}</table>` : ""}<p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#62716a;">开始时间：${escapeHtml(firstSeen)}<br>最近一次观察：${escapeHtml(lastSeen)}${duration ? `<br>持续时长：${escapeHtml(duration)}` : ""}</p>${detail}<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #d6ddd5;font-size:12px;line-height:1.8;color:#62716a;">来源：${escapeHtml(source)}${incidentId ? `<br>事故编号：${escapeHtml(incidentId)}` : ""}<br>为什么收到这封邮件：${escapeHtml(reason)}</p></td></tr><tr><td align="center" style="padding:24px 8px;font-size:12px;line-height:1.8;color:#62716a;">${escapeHtml(PRODUCT_BRAND)} · 你的个人工作空间</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

const FEISHU_CARD_LIMIT = 30 * 1024;
const cardTemplate = (parts: NotificationParts) => parts.event.state === "resolved" ? "green" : parts.event.kind === "notify.selftest" || parts.event.severity === "info" ? "blue" : parts.event.severity === "critical" ? "red" : "orange";

function plainTextElement(content: string) {
  return { tag: "div", text: { tag: "plain_text", content } };
}

function feishuCardValue(parts: NotificationParts, facts: NonNullable<NotificationParts["facts"]>, conclusion: string) {
  const factElements = facts.map(fact => plainTextElement(`- ${fact.label}：${fact.value}`));
  const metadata = [`开始时间：${parts.firstSeen}`, `最近一次观察：${parts.lastSeen}`, ...(parts.duration ? [`持续时长：${parts.duration}`] : []), `来源：${parts.source}`, ...(parts.incidentId ? [`事故编号：${parts.incidentId}`] : [])].map(plainTextElement);
  const elements: Record<string, unknown>[] = [plainTextElement(conclusion), ...factElements, ...metadata, { tag: "div", text: { tag: "plain_text", content: parts.reason, text_size: "notation" } }];
  if (parts.link) elements.push({ tag: "button", text: { tag: "plain_text", content: "查看详情" }, type: "default", behaviors: [{ type: "open_url", default_url: parts.link }] });
  return { schema: "2.0", header: { template: cardTemplate(parts), title: { tag: "plain_text", content: parts.subject } }, body: { elements } };
}

export function buildFeishuCard(input: NotificationParts | NotificationEmailInput) {
  const parts = "prefix" in input ? input : notificationParts(input);
  let facts = [...(parts.facts ?? [])];
  let conclusion = parts.conclusion;
  let card = feishuCardValue(parts, facts, conclusion);
  const size = () => new TextEncoder().encode(JSON.stringify(card)).byteLength;
  while (size() > FEISHU_CARD_LIMIT && facts.length > 0) {
    facts = facts.slice(0, -1);
    card = feishuCardValue(parts, facts, conclusion);
  }
  while (size() > FEISHU_CARD_LIMIT && conclusion.length > 128) {
    const nextLength = Math.max(0, Math.min(conclusion.length - 2, Math.floor(conclusion.length * 0.75)));
    if (nextLength >= conclusion.length - 1) break;
    conclusion = `${conclusion.slice(0, nextLength)}…`;
    card = feishuCardValue(parts, facts, conclusion);
  }
  if (size() > FEISHU_CARD_LIMIT) {
    const compact = { ...parts, subject: parts.subject.slice(0, 120), conclusion: conclusion.slice(0, 64) };
    card = feishuCardValue(compact, [], compact.conclusion);
  }
  return card;
}
