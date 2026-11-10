export const NOTIFY_SCHEMA = "notify.event/v1" as const;

export type NotifyState = "firing" | "resolved" | "info";
export type NotifySeverity = "info" | "warning" | "critical";

export interface NotifyFact {
  label: string;
  value: string;
}

export interface NotifyEvent {
  schema: typeof NOTIFY_SCHEMA;
  event_id: string;
  source: string;
  kind: string;
  subject: string;
  state: NotifyState;
  severity: NotifySeverity;
  occurred_at: string;
  title: string;
  summary?: string;
  facts?: NotifyFact[];
  link?: string;
}

export class NotifyValidationError extends Error {
  readonly code = "E_INVALID_EVENT";
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "NotifyValidationError";
  }
}

const allowed = new Set([
  "schema", "event_id", "source", "kind", "subject", "state", "severity",
  "occurred_at", "title", "summary", "facts", "link",
]);
const scalar = (value: unknown): value is string => typeof value === "string" && !/[<>]/.test(value);

export function validateNotifyEvent(input: unknown): NotifyEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new NotifyValidationError("event must be an object");
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new NotifyValidationError(`unknown field: ${key}`);
  if (value.schema !== NOTIFY_SCHEMA) throw new NotifyValidationError("schema must be notify.event/v1");
  for (const key of ["event_id", "source", "kind", "subject", "title"]) {
    if (!scalar(value[key]) || !(value[key] as string).trim()) throw new NotifyValidationError(`${key} is required and must be plain text`);
  }
  if (!scalar(value.summary ?? "")) throw new NotifyValidationError("summary must be plain text");
  if (typeof value.summary === "string" && value.summary.length > 500) throw new NotifyValidationError("summary is too long");
  if (!scalar(value.title) || (value.title as string).length > 80) throw new NotifyValidationError("title is too long");
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(value.event_id as string)) throw new NotifyValidationError("invalid event_id");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(value.source as string)) throw new NotifyValidationError("invalid source");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(value.kind as string)) throw new NotifyValidationError("invalid kind");
  if (!/^[^\r\n<>]{1,200}$/.test(value.subject as string)) throw new NotifyValidationError("invalid subject");
  if (!["firing", "resolved", "info"].includes(value.state as string)) throw new NotifyValidationError("invalid state");
  if (!["info", "warning", "critical"].includes(value.severity as string)) throw new NotifyValidationError("invalid severity");
  if (typeof value.occurred_at !== "string" || Number.isNaN(Date.parse(value.occurred_at))) throw new NotifyValidationError("occurred_at must be ISO time");
  if (value.facts !== undefined) {
    if (!Array.isArray(value.facts) || value.facts.length > 12) throw new NotifyValidationError("facts must contain at most 12 items");
    for (const fact of value.facts) {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) throw new NotifyValidationError("invalid fact");
      const keys = Object.keys(fact as object);
      if (keys.length !== 2 || !keys.includes("label") || !keys.includes("value")) throw new NotifyValidationError("invalid fact fields");
      const item = fact as Record<string, unknown>;
      if (!scalar(item.label) || !scalar(item.value) || !item.label || !item.value) throw new NotifyValidationError("fact values must be strings");
    }
  }
  if (value.link !== undefined) {
    if (typeof value.link !== "string") throw new NotifyValidationError("link must be a URL");
    let url: URL;
    try { url = new URL(value.link); } catch { throw new NotifyValidationError("link must be a URL"); }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".codepi.app") || url.hostname === "codepi.app" || url.username || url.password) {
      throw new NotifyValidationError("link must be an https codepi.app page");
    }
  }
  return {
    schema: NOTIFY_SCHEMA,
    event_id: value.event_id as string,
    source: value.source as string,
    kind: value.kind as string,
    subject: value.subject as string,
    state: value.state as NotifyState,
    severity: value.severity as NotifySeverity,
    occurred_at: value.occurred_at as string,
    title: value.title as string,
    ...(typeof value.summary === "string" && value.summary ? { summary: value.summary } : {}),
    ...(Array.isArray(value.facts) ? { facts: value.facts as NotifyFact[] } : {}),
    ...(typeof value.link === "string" ? { link: value.link } : {}),
  };
}

export const parseNotifyEvent = validateNotifyEvent;
export function isNotifyEvent(input: unknown): input is NotifyEvent {
  try { validateNotifyEvent(input); return true; } catch { return false; }
}
