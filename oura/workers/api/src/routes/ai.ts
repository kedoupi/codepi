import type { Env } from "../env";
import { requireSession, isResponse } from "../lib/authz";
import { capabilities } from "../lib/capabilities.ts";
import { clampDays } from "../lib/daily";
import { loadSubscription } from "../lib/subscription";
import { loadDailyForSession, isDailyResponse } from "../lib/user-daily";
import { buildWeeklyReport } from "../lib/weekly-report";

export async function handleMeAi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  const days = clampDays(Number(new URL(request.url).searchParams.get("days") || 30));
  const daily = await loadDailyForSession(request, env, auth.session, days);
  if (!isDailyResponse(daily)) return daily;
  const sub = await loadSubscription(env, auth.session.user_id);
  const caps = capabilities(env, auth.session.user_id, sub?.status);
  const weekly = buildWeeklyReport(daily.days);
  const evidence = weekly.summaries.map((detail, i) => ({ id: `metric-${i}`, title: ["睡眠", "准备度", "活动"][i], detail }));
  const report = {
    verdict: "按官方日汇总对照近期变化；数据不足的项目不推断。非医疗建议。",
    findings: evidence.map(item => ({ title: item.title, detail: item.detail })),
    actions: caps.weeklyFull ? weekly.tips : [],
  };
  const result = {
    ok: true, days, from: daily.from, to: daily.to,
    report, source: "template", model: "规则解读", generatedAt: new Date().toISOString(),
    sync: daily.sync, fallbackReason: caps.ai ? "insufficient_data" : "not_configured",
    evidence, aiPolicy: "AI only orders verified findings; all numbers and text are computed from source data.",
  };
  const populated = daily.days.filter(day => day.sleep || day.readiness || day.activity);
  const material = JSON.stringify({ evidence, actions: report.actions, from: daily.from, to: daily.to, model: env.AI_MODEL, policy: 1 });
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const existing = await env.DB.prepare("SELECT payload FROM analysis_cache WHERE user_id=? AND fingerprint=?")
    .bind(auth.session.user_id, hash).first<{ payload: string }>();
  if (existing) return Response.json({ ...JSON.parse(existing.payload), cached: true, sync: daily.sync });
  if (!caps.ai || populated.length < 3 || daily.sync?.stale) {
    if (!daily.sync?.stale) {
      await env.DB.prepare("INSERT OR REPLACE INTO analysis_cache (user_id, fingerprint, payload, created_at) VALUES (?, ?, ?, ?)")
        .bind(auth.session.user_id, hash, JSON.stringify(result), result.generatedAt).run();
    }
    return Response.json(result);
  }
  const limit = Math.max(0, Math.min(20, Number(env.AI_DAILY_LIMIT) || 0));
  const reserved = await env.DB.prepare(
    `INSERT INTO analysis_usage (user_id, day, requests) SELECT ?, ?, 1 WHERE ? > 0
     ON CONFLICT(user_id, day) DO UPDATE SET requests=requests+1 WHERE requests < ?
     RETURNING requests`,
  ).bind(auth.session.user_id, new Date().toISOString().slice(0, 10), limit, limit).first();
  if (!reserved) return Response.json({ ...result, fallbackReason: "daily_limit" });
  try {
    const base = new URL(env.AI_BASE_URL!);
    if (base.protocol !== "https:") throw new Error("invalid_provider");
    const response = await fetch(`${base.href.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_API_KEY}` },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: env.AI_MODEL, temperature: 0, max_tokens: 100,
        messages: [
          { role: "system", content: 'Order the supplied finding IDs by magnitude of reported change. Do not diagnose or create claims. Return only JSON: {"order":["metric-0","metric-1","metric-2"]}. Include each provided ID exactly once.' },
          { role: "user", content: JSON.stringify(evidence) },
        ],
      }),
    });
    if (!response.ok) throw new Error("provider_unavailable");
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const order: unknown = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}").order;
    if (!Array.isArray(order) || order.length !== evidence.length || new Set(order).size !== evidence.length ||
      order.some(id => !evidence.some(item => item.id === id))) throw new Error("invalid_output");
    const output = {
      ...result, source: "ai-ranked", model: env.AI_MODEL, fallbackReason: null,
      report: { ...report, findings: order.map(id => evidence.find(item => item.id === id)!) },
    };
    await env.DB.prepare("INSERT OR REPLACE INTO analysis_cache (user_id, fingerprint, payload, created_at) VALUES (?, ?, ?, ?)")
      .bind(auth.session.user_id, hash, JSON.stringify(output), output.generatedAt).run();
    return Response.json(output);
  } catch {
    return Response.json({ ...result, fallbackReason: "provider_unavailable" });
  }
}
