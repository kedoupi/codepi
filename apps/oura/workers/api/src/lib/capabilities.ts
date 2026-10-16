import type { Env } from "../env";

export function capabilities(env: Env, userId: string | null) {
  const personal = Boolean(userId && env.PERSONAL_OWNER_ID && userId === env.PERSONAL_OWNER_ID);
  return {
    personal,
    weeklyFull: personal,
    compare: personal,
    analysis: Boolean(userId),
    ai: Boolean(userId && env.AI_ENABLED === "1" && env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL),
  };
}
