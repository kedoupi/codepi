import type { NotifyEvent } from "../../../packages/shared/notify/contract.ts";
import type { NotifyRule } from "./rules.ts";

const RETRYABLE: Record<string, true> = {
  E_RATE_LIMIT_EXCEEDED: true,
  E_DELIVERY_FAILED: true,
  E_INTERNAL_SERVER_ERROR: true,
  E_FEISHU_99991663: true,
  E_FEISHU_99991400: true,
  E_FEISHU_230020: true,
  E_FEISHU_NETWORK: true,
};
// At most 4 attempts in total: the first send plus retries after 5, 15 and 60 minutes.
const RETRY_MINUTES = [5, 15, 60];

// attempts = failed attempts recorded before this failure.
export function retryAt(errorCode: string, attempts: number, now = Date.now()): string | null {
  const minutes = RETRY_MINUTES[attempts];
  const retryable = RETRYABLE[errorCode] || /^E_FEISHU_HTTP_(429|5\d\d)$/.test(errorCode);
  if (!retryable || minutes === undefined) return null;
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export interface Decision { decision: string; shouldSend: boolean; reason: string; }
export function decideNotification(event: NotifyEvent, rule: NotifyRule, incident: { status?: string; firstSeen?: string; lastNotificationAt?: string | null; pendingUntil?: string | null } | null, now = Date.now()): Decision {
  if (rule.mode === "record" || rule.infoMode === "record" && event.severity === "info") return { decision: "record", shouldSend: false, reason: "record_only" };
  // A closed incident that fires again is a new episode: no for/cooldown state carries over.
  if (event.state !== "resolved" && incident && incident.status !== "open") incident = null;
  if (event.state === "resolved") {
    if (!incident || incident.status !== "open" || !rule.notifyResolved) return { decision: "resolved", shouldSend: false, reason: "resolved_without_notification" };
    if (incident.pendingUntil && Date.parse(incident.pendingUntil) > now) return { decision: "resolved", shouldSend: false, reason: "resolved_before_for" };
    // Nothing was ever sent for this episode (e.g. firing still pending): cancel it silently, no recovery email.
    if (!incident.lastNotificationAt) return { decision: "resolved", shouldSend: false, reason: "resolved_never_notified" };
    return { decision: "send_resolved", shouldSend: true, reason: "resolved" };
  }
  // A new (or reopened) episode starts at this event, so `for` also applies to its very first firing.
  const firstSeen = incident?.firstSeen ?? event.occurred_at;
  if (rule.forMs > 0 && now - Date.parse(firstSeen) < rule.forMs) return { decision: "deferred_for", shouldSend: false, reason: "for_not_elapsed" };
  if (rule.cooldownMs && incident?.lastNotificationAt) {
    if (now - Date.parse(incident.lastNotificationAt) < rule.cooldownMs) return { decision: "cooled_down", shouldSend: false, reason: "cooldown" };
    return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "cooldown_elapsed" };
  }
  return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "rule_matched" };
}
