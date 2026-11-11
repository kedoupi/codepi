import { RPC_SOURCE, RULES as DATA_RULES } from "./rules.data.mjs";

export type NotifyMode = "alert" | "immediate" | "digest" | "record";
export type QuietMode = "defer" | "ignore" | "none";
export interface NotifyRule {
  kind: string;
  sources: string[];
  mode: NotifyMode;
  for: number;
  forMs: number;
  cooldown?: number;
  cooldownMs?: number;
  notifyResolved?: boolean;
  infoMode?: "record";
  quiet: QuietMode;
  batch?: "alone";
}

export { RPC_SOURCE };
const MODES: readonly NotifyMode[] = ["alert", "immediate", "digest", "record"];
const QUIET_MODES: readonly QuietMode[] = ["defer", "ignore", "none"];
function oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`invalid rule ${field}: ${value}`);
  return value as T;
}
export const RULES: readonly NotifyRule[] = DATA_RULES.map(rule => ({
  ...rule,
  mode: oneOf(rule.mode, MODES, "mode"),
  quiet: oneOf(rule.quiet, QUIET_MODES, "quiet"),
  for: rule.forMs,
  cooldown: rule.cooldownMs,
  infoMode: rule.infoMode === "record" ? "record" : undefined,
  batch: rule.batch === "alone" ? "alone" : undefined,
}));

export function findRule(source: string, kind: string) {
  const rule = RULES.find(candidate => candidate.kind === kind);
  if (!rule || !rule.sources.includes(source)) return undefined;
  return rule;
}
export function allowedKinds(source: string) { return RULES.filter(rule => rule.sources.includes(source)).map(rule => rule.kind); }
