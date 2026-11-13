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

export type FeishuCardCategory = "alert" | "status" | "approval" | "delivery" | "notice";

const CATEGORY_NAMES: Record<FeishuCardCategory, string> = {
  alert: "提醒",
  status: "状态变化",
  approval: "待批准",
  delivery: "已交付",
  notice: "通知",
};

const KIND_CATEGORY: Record<string, FeishuCardCategory> = {
  "agent.stuck": "alert", "job.unhealthy": "alert", "magpie.unresponsive": "alert",
  "magpie.source_disabled": "alert", "magpie.spend": "alert", "ledger.status": "status",
  "approval.pending": "approval", "ledger.delivered": "delivery",
};

const KIND_LABELS: Record<string, string> = {
  "agent.stuck": "提醒", "job.unhealthy": "提醒", "magpie.unresponsive": "提醒",
  "magpie.source_disabled": "提醒", "magpie.spend": "提醒", "ledger.status": "状态变化",
  "approval.pending": "待批准", "ledger.delivered": "已交付", "ledger.digest": "账务摘要",
  "daily-review": "日常复盘", "job.health": "健康检查", "notify.selftest": "自检",
  "notify.merged": "合并提醒",
};

export const feishuCardCategory = (kind: string): FeishuCardCategory => KIND_CATEGORY[kind] ?? "notice";
export const feishuKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

const escapeMarkdown = (value: string) => value.replace(/[\\*_`[\]<>\n]/g, char => ({ "\\": "\\\\", "*": "\\*", "_": "\\_", "`": "\\`", "[": "\\[", "]": "\\]", "<": "\\<", ">": "\\>", "\n": " " }[char] ?? char));
const categoryColor = (category: FeishuCardCategory, parts: NotificationParts) => {
  if (parts.event.state === "resolved") return "green";
  if (category === "alert") return parts.event.severity === "critical" ? "red" : parts.event.severity === "warning" ? "orange" : "green";
  return category === "approval" ? "yellow" : category === "delivery" ? "green" : "blue";
};
const categoryTag = (category: FeishuCardCategory, parts: NotificationParts) => parts.event.state === "resolved" ? "已恢复" : category === "alert" ? (parts.event.severity === "critical" ? "严重" : parts.event.severity === "warning" ? "注意" : "通知") : CATEGORY_NAMES[category];
const beijingTime = (value: string) => { const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)); const get = (type: string) => parts.find(part => part.type === type)?.value ?? ""; return `${get("month")}-${get("day")} ${get("weekday")} ${get("hour")}:${get("minute")}`; };

type CardElement = Record<string, unknown>;
const markdown = (content: string): CardElement => ({ tag: "markdown", content });
const columns = (facts: NonNullable<NotificationParts["facts"]>): CardElement => ({ tag: "column_set", flex_mode: "none", columns: Array.from({ length: Math.ceil(facts.length / 2) * 2 }, (_, index) => ({ tag: "column", width: "weighted", weight: 1, elements: index < facts.length ? [markdown(`**${escapeMarkdown(facts[index].label)}**\\n${escapeMarkdown(facts[index].value)}`)] : [] })) });
const factRows = (facts: NonNullable<NotificationParts["facts"]>) => facts.length ? [columns(facts)] : [];

function feishuCardValue(parts: NotificationParts, facts: NonNullable<NotificationParts["facts"]>, conclusion: string) {
  const category = feishuCardCategory(parts.event.kind);
  const tag = categoryTag(category, parts);
  const elements: CardElement[] = [markdown(`**${escapeMarkdown(conclusion)}**`)];
  if (category === "status") {
    const old = facts.find(fact => fact.label === "旧状态");
    const next = facts.find(fact => fact.label === "新状态");
    if (old && next) elements.push(columns([old, next]), ...factRows(facts.filter(fact => fact !== old && fact !== next)));
    else elements.push(...factRows(facts));
  } else if (category === "delivery") {
    const accepted = facts.find(fact => fact.label === "验收");
    if (accepted) elements.push(columns([accepted]), ...factRows(facts.filter(fact => fact !== accepted)));
    else elements.push(...factRows(facts));
  } else elements.push(...factRows(facts));
  elements.push({ tag: "hr" });
  const footer = `北京时间 ${beijingTime(parts.event.occurred_at)} · 来源：${escapeMarkdown(parts.source)}${parts.reason && parts.reason !== "这是统一通知服务根据事件规则生成的提醒。" ? ` · ${escapeMarkdown(parts.reason)}` : ""}`;
  elements.push({ ...markdown(`<font color='grey'>${footer}</font>`), text_size: "notation" });
  if (parts.link) elements.push({ tag: "button", text: { tag: "text", content: category === "approval" ? "去批准" : category === "delivery" ? "查看交付" : "查看详情" }, type: "primary", behaviors: [{ type: "open_url", default_url: parts.link }] });
  return { schema: "2.0", header: { title: { tag: "plain_text", content: parts.event.title }, subtitle: { tag: "plain_text", content: CATEGORY_NAMES[category] }, template: categoryColor(category, parts), text_tag_list: [{ tag: "text_tag", text: { tag: "plain_text", content: tag }, color: categoryColor(category, parts) }] }, body: { elements } };
}

export function buildFeishuCard(input: NotificationParts | NotificationEmailInput) {
  const parts = "prefix" in input ? input : notificationParts(input);
  let facts = [...(parts.facts ?? [])];
  let conclusion = parts.conclusion;
  let card = feishuCardValue(parts, facts, conclusion);
  const size = () => new TextEncoder().encode(JSON.stringify(card)).byteLength;
  while (size() > FEISHU_CARD_LIMIT && facts.length > 0) { facts = facts.slice(0, -1); card = feishuCardValue(parts, facts, conclusion); }
  while (size() > FEISHU_CARD_LIMIT && conclusion.length > 128) { const nextLength = Math.max(0, Math.min(conclusion.length - 2, Math.floor(conclusion.length * 0.75))); if (nextLength >= conclusion.length - 1) break; conclusion = `${conclusion.slice(0, nextLength)}…`; card = feishuCardValue(parts, facts, conclusion); }
  if (size() > FEISHU_CARD_LIMIT) { const compact = { ...parts, subject: parts.subject.slice(0, 120), conclusion: conclusion.slice(0, 64) }; card = feishuCardValue(compact, [], compact.conclusion); }
  return card;
}
