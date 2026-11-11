export const RPC_SOURCE = "rpc";
export const RULES = [
  { kind: "agent.stuck", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: true, quiet: "defer" },
  { kind: "approval.pending", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, cooldownMs: 6 * 60 * 60 * 1000, notifyResolved: false, quiet: "defer" },
  { kind: "plans.orphan_digest", sources: ["surgeconf.watchdog"], mode: "record", forMs: 0, quiet: "none" },
  { kind: "notify.selftest", sources: ["surgeconf.watchdog", RPC_SOURCE], mode: "immediate", forMs: 0, notifyResolved: false, quiet: "none" },
  { kind: "daily-review", sources: ["surgeconf.watchdog"], mode: "alert", forMs: 0, notifyResolved: false, quiet: "defer", infoMode: "record" },
  { kind: "job.health", sources: ["mybrain.job-health"], mode: "alert", forMs: 0, notifyResolved: false, quiet: "none", batch: "alone" },
  { kind: "job.unhealthy", sources: ["mybrain.job-health"], mode: "alert", forMs: 0, notifyResolved: true, quiet: "defer" },
];
