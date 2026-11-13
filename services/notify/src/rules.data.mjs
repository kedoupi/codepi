export const RPC_SOURCE = "rpc";
export const RULES = [
  { kind: "agent.stuck", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: true },
  { kind: "approval.pending", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: false },
  { kind: "plans.orphan_digest", sources: ["surgeconf.watchdog"], mode: "record", forMs: 0 },
  { kind: "notify.selftest", sources: ["surgeconf.watchdog", RPC_SOURCE], mode: "immediate", forMs: 0, notifyResolved: false },
  { kind: "daily-review", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, notifyResolved: false, infoMode: "record" },
  { kind: "job.health", sources: ["mybrain.job-health"], mode: "alert", forMs: 0, notifyResolved: false, batch: "alone" },
  { kind: "job.unhealthy", sources: ["mybrain.job-health"], mode: "alert", forMs: 0, notifyResolved: true },
  { kind: "ledger.digest", sources: ["mybrain.ledger"], mode: "alert", forMs: 0, notifyResolved: false, batch: "alone" },
  { kind: "magpie.unresponsive", sources: ["mybrain.magpie"], mode: "alert", forMs: 0, notifyResolved: true, infoMode: "record" },
  { kind: "magpie.source_disabled", sources: ["mybrain.magpie"], mode: "alert", forMs: 0, notifyResolved: true },
  { kind: "magpie.spend", sources: ["mybrain.magpie"], mode: "alert", forMs: 0, notifyResolved: false },
  { kind: "ledger.status", sources: ["mybrain.ledger"], mode: "alert", forMs: 0, notifyResolved: false, batch: "alone" },
  { kind: "ledger.delivered", sources: ["mybrain.ledger"], mode: "alert", forMs: 0, notifyResolved: false, batch: "alone" },
];
