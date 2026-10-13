import type { Env } from "../env";
import { isEntitled, stripeConfigured } from "./subscription";

export function capabilities(env: Env, userId: string | null, status?: string | null) {
  const personal = Boolean(userId && env.PERSONAL_OWNER_ID && userId === env.PERSONAL_OWNER_ID);
  const full = Boolean(userId && (personal || isEntitled(status)));
  return {
    personal,
    weeklyFull: full,
    compare: full,
    analysis: Boolean(userId),
    ai: Boolean(userId && env.AI_ENABLED === "1" && env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL),
    billing: Boolean(userId && !personal && stripeConfigured(env)),
  };
}
