/** Internal capability contract. Only the named Health Worker RPC exposes it. */
export const HEALTH_OPERATIONS = ["catalog", "query_records", "aggregate", "sync_status"] as const;
export type HealthOperation = typeof HEALTH_OPERATIONS[number];
export type HealthRequest = {
  subject: string;
  operation: HealthOperation;
  args: Record<string, unknown>;
};
export type HealthReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };
export interface HealthService {
  execute(request: HealthRequest): Promise<HealthReply>;
}
