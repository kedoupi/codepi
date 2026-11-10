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

export const RPC_SOURCE = "rpc";
export const RULES: readonly NotifyRule[] = [
  { kind: "agent.stuck", sources: ["surgeconf.watchdog"], mode: "alert", for: 0, forMs: 0, cooldown: 6 * 60 * 60 * 1000, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: true, quiet: "defer" },
  { kind: "approval.pending", sources: ["surgeconf.watchdog"], mode: "alert", for: 0, forMs: 0, cooldown: 6 * 60 * 60 * 1000, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: false, quiet: "defer" },
  { kind: "plans.orphan_digest", sources: ["surgeconf.watchdog"], mode: "record", for: 0, forMs: 0, quiet: "none" },
  { kind: "notify.selftest", sources: ["surgeconf.watchdog", RPC_SOURCE], mode: "immediate", for: 0, forMs: 0, notifyResolved: false, quiet: "none" },
];

export function findRule(source: string, kind: string) {
  const rule = RULES.find(candidate => candidate.kind === kind);
  if (!rule || !rule.sources.includes(source)) return undefined;
  return rule;
}
export function allowedKinds(source: string) { return RULES.filter(rule => rule.sources.includes(source)).map(rule => rule.kind); }
