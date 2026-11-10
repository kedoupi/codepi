import type { NotifyEvent } from "../../../packages/shared/notify/contract.ts";
import type { NotifyRule } from "./rules.ts";

const RETRYABLE: Record<string, true> = {
  E_RATE_LIMIT_EXCEEDED: true,
  E_DELIVERY_FAILED: true,
  E_INTERNAL_SERVER_ERROR: true,
};
const RETRY_MINUTES = [5, 15, 60];

export function retryAt(errorCode: string, attempts: number, now = Date.now()): string | null {
  if (!RETRYABLE[errorCode] || attempts >= 4) return null;
  const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length - 1)];
  return new Date(now + minutes * 60 * 1000).toISOString();
}
export function isQuietHours(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
  return hour >= 23 || hour < 8;
}

export function quietEnd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  const end = new Date(`${date}T08:00:00+08:00`);
  if (hour >= 8 && hour < 23) return end.toISOString();
  if (hour >= 23) end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

export interface Decision { decision: string; shouldSend: boolean; reason: string; }
export function decideNotification(event: NotifyEvent, rule: NotifyRule, incident: { status?: string; firstSeen?: string; lastNotificationAt?: string | null; pendingUntil?: string | null } | null, now = Date.now()): Decision {
  if (rule.mode === "record") return { decision: "record", shouldSend: false, reason: "record_only" };
  if (event.state === "resolved") {
    if (!incident || incident.status !== "open" || !rule.notifyResolved) return { decision: "resolved", shouldSend: false, reason: "resolved_without_notification" };
    if (incident.pendingUntil && Date.parse(incident.pendingUntil) > now) return { decision: "resolved", shouldSend: false, reason: "resolved_before_for" };
    return { decision: "send_resolved", shouldSend: true, reason: "resolved" };
  }
  if (rule.forMs > 0 && incident?.firstSeen && now - Date.parse(incident.firstSeen) < rule.forMs) return { decision: "deferred_for", shouldSend: false, reason: "for_not_elapsed" };
  if (rule.quiet === "defer" && event.severity === "warning" && isQuietHours(new Date(now))) return { decision: "deferred_quiet", shouldSend: false, reason: "quiet_hours" };
  if (rule.cooldownMs && incident?.lastNotificationAt) {
    if (now - Date.parse(incident.lastNotificationAt) < rule.cooldownMs) return { decision: "cooled_down", shouldSend: false, reason: "cooldown" };
    return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "cooldown_elapsed" };
  }
  return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "rule_matched" };
}
