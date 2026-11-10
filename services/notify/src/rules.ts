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
  quiet: QuietMode;
}

export { RPC_SOURCE };
export const RULES: readonly NotifyRule[] = DATA_RULES.map(rule => ({
  ...rule,
  for: rule.forMs,
  cooldown: rule.cooldownMs,
})) satisfies readonly NotifyRule[];

export function findRule(source: string, kind: string) {
  const rule = RULES.find(candidate => candidate.kind === kind);
  if (!rule || !rule.sources.includes(source)) return undefined;
  return rule;
}
export function allowedKinds(source: string) { return RULES.filter(rule => rule.sources.includes(source)).map(rule => rule.kind); }
