import { env, createExecutionContext } from "cloudflare:test";
import { MeMcp } from "../worker/index";
import type { DomainReply, MeOperation } from "@kedoupi/shared/mcp/contract";
export const rpc = () => new MeMcp(createExecutionContext(), env);
export const call = (operation: MeOperation, args: Record<string, unknown> = {}, client = "synthetic-client") =>
  rpc().execute({ subject: "kdp-owner", client, clientName: "Synthetic AI", operation, args });
export function data(reply: DomainReply): Record<string, unknown> {
  if (!reply.ok) throw new Error(`Unexpected reply: ${reply.error}`);
  return reply.data;
}
export async function count(table: string, where = "1=1") {
  return await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).first<number>("n");
}
