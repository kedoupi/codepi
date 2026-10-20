import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { GuMcp } from "../worker/index";
import { hash } from "../worker/lib";
import { emptyWorkspace, type WorkspaceData } from "../worker/workspace-types";
import type { Env } from "../worker/types";

const createdAt = "2026-10-20T03:00:00.000Z";

function mcp(bindings: Env = env) {
  return new GuMcp(createExecutionContext(), bindings);
}

function sample(): WorkspaceData {
  const value = emptyWorkspace();
  value.account.name = "合成投资账户";
  value.account.confirmed_on = "2026-10-01";
  value.account.notes = "合成备注";
  value.account.holdings = [
    {
      id: "holding-one", symbol: "TEST", name: "合成持仓一", account: "测试券商",
      currency: "USD", quantity: "0.100000", cost_total: null, value_usd: null,
      valued_on: null, source: "合成估值一",
    },
    {
      id: "holding-two", symbol: "ZERO", name: "合成零值", account: "测试券商",
      currency: "USD", quantity: "1", cost_total: "0", value_usd: "0",
      valued_on: "2026-10-01", source: "合成估值二",
    },
    {
      id: "holding-three", symbol: "THREE", name: "合成持仓三", account: "测试券商",
      currency: "USD", quantity: "3", cost_total: "1.230000", value_usd: "1.230000",
      valued_on: "2026-10-01", source: "合成估值三",
    },
  ];
  value.account.cash = [{
    id: "cash-one", name: "合成现金", account: "测试券商", currency: "USD",
    amount: null, value_usd: "0", confirmed_on: "2026-10-01", source: "合成现金来源",
  }];
  value.account.trades = [{
    id: "trade-one", date: "2026-09-30", account: "测试券商", kind: "buy",
    symbol: "TEST", currency: "USD", quantity: "0.100000", amount: "0.500000",
    note: "合成流水备注",
  }];
  value.rules = { title: "合成规则", body: "规则正文第一段。\n规则正文第二段。" };
  value.reports = [{
    id: "report-one", title: "合成报告一", date: "2026-10-01", trading_date: "2026-09-30",
    date_source: "front_matter", kind: "复盘", summary: "合成报告摘要", body: "报告正文第一段。\n报告正文第二段。",
    source: "合成报告来源", based_on_revision: 1,
  }];
  return value;
}

async function seed(value: WorkspaceData, revision = 1, at = createdAt) {
  const payload = JSON.stringify(value);
  await env.DB.prepare(
    "INSERT INTO gu_workspace_versions(revision,request_id,digest,created_at,payload) VALUES(?,?,?,?,?)",
  ).bind(revision, `synthetic-request-${revision}`, await hash(payload), at, payload).run();
  await env.DB.prepare("UPDATE gu_workspace_head SET revision=? WHERE singleton=1").bind(revision).run();
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

beforeEach(async () => {
  await env.DB.exec(`UPDATE gu_workspace_head SET revision=0; DELETE FROM gu_workspace_versions;
    DELETE FROM dashboard_current; DELETE FROM dashboard_batches;`);
});

describe("GU MCP read-only contract", () => {
  it("returns an explicit empty result without reading the legacy dashboard", async () => {
    const legacy = JSON.stringify({
      account: [{ data_mode: "live", total_usd: 999 }],
      positions: [{ ticker: "LEGACY-SECRET", value_usd: 999 }],
      risk: [], market: [], reports: [],
    });
    const batch = await hash(legacy);
    await env.DB.prepare("INSERT INTO dashboard_batches VALUES(?,?,?,?)")
      .bind(batch, createdAt, createdAt, legacy).run();
    await env.DB.prepare("INSERT INTO dashboard_current VALUES(1,?)").bind(batch).run();

    for (const operation of ["portfolio", "cash", "trades", "rules", "reports"] as const) {
      const reply = await mcp().execute({ subject: "kdp-owner", operation, args: {} });
      expect(reply.ok).toBe(true);
      if (!reply.ok) continue;
      expect(reply.data).toMatchObject({
        operation, empty: true, revision: 0, updated_at: null, as_of: null,
      });
      expect(JSON.stringify(reply)).not.toContain("LEGACY-SECRET");
      expect(reply.data.page).toMatchObject({ returned: 0, next_offset: null });
      expect(reply.data.truncation).toEqual({ truncated: false, fields: [] });
    }
    const summary = await mcp().summary("kdp-owner");
    expect(summary).toMatchObject({ source: "gu", status: "empty" });
    expect(JSON.stringify(summary)).not.toContain("LEGACY-SECRET");
  });

  it("enforces fixed ownership and accepts only exact argument keys", async () => {
    await seed(sample());
    await expect(mcp().execute({ subject: "someone-else", operation: "portfolio", args: {} }))
      .resolves.toEqual({ ok: false, error: "not_owner", status: 403 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { user_id: "someone-else" },
    })).resolves.toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { unexpected: true },
    })).resolves.toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { revision: 0 },
    })).resolves.toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { limit: 101 },
    })).resolves.toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "rules", args: { limit: 4001 },
    })).resolves.toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    expect((await mcp().execute({
      subject: "kdp-owner", operation: "rules", args: { limit: 101 },
    })).ok).toBe(true);
    expect((await mcp().summary("someone-else"))).toMatchObject({ source: "gu", status: "unavailable" });
  });

  it("pins record pagination to the revision and reports a changed revision", async () => {
    await seed(sample(), 1);
    const first = await mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { offset: 0, limit: 1 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toMatchObject({ revision: 1, updated_at: createdAt, as_of: "2026-10-01" });
    expect(first.data.page).toMatchObject({ unit: "records", offset: 0, limit: 1, returned: 1, next_offset: 1 });

    const second = await mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { revision: 1, offset: 1, limit: 1 },
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect((second.data.holdings as { id: string }[])[0].id).toBe("holding-two");

    const next = sample();
    next.account.holdings.push({
      id: "holding-four", symbol: "FOUR", name: "合成持仓四", account: "测试券商",
      currency: null, quantity: null, cost_total: null, value_usd: null, valued_on: null, source: "",
    });
    await seed(next, 2, "2026-10-20T04:00:00.000Z");

    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { revision: 1, offset: 1, limit: 1 },
    })).resolves.toEqual({ ok: false, error: "revision_changed", status: 409 });
    await expect(mcp().execute({
      subject: "kdp-owner", operation: "portfolio", args: { offset: 1, limit: 1 },
    })).resolves.toEqual({ ok: false, error: "revision_required", status: 409 });
  });

  it("preserves decimal text, units and missing values in every operation", async () => {
    await seed(sample());
    const portfolio = await mcp().execute({ subject: "kdp-owner", operation: "portfolio", args: {} });
    expect(portfolio.ok).toBe(true);
    if (portfolio.ok) {
      const holdings = portfolio.data.holdings as Record<string, unknown>[];
      expect(portfolio.data).toMatchObject({
        operation: "portfolio", revision: 1, updated_at: createdAt, as_of: "2026-10-01",
        units: { value_usd: "USD", quantity: expect.stringContaining("decimal text") },
        account: { record_counts: { holdings: 3, cash: 1, trades: 1, reports: 1 }, valuation: { total_usd: null, missing: 1 } },
      });
      expect(holdings[0]).toMatchObject({ quantity: "0.100000", cost_total: null, value_usd: null });
      expect(holdings[1].value_usd).toBe("0");
      expect(holdings[2].cost_total).toBe("1.230000");
    }

    for (const [operation, key] of [["cash", "cash"], ["trades", "trades"], ["rules", "rule"], ["reports", "reports"]] as const) {
      const reply = await mcp().execute({ subject: "kdp-owner", operation, args: {} });
      expect(reply.ok).toBe(true);
      if (!reply.ok) continue;
      expect(reply.data).toMatchObject({ operation, revision: 1, updated_at: createdAt, as_of: "2026-10-01" });
      expect(reply.data[key]).toBeDefined();
      expect(reply.data.page).toBeDefined();
      expect(reply.data.truncation).toBeDefined();
    }

    const summary = await mcp().summary("kdp-owner");
    expect(summary).toMatchObject({ source: "gu", status: "ok", updatedAt: createdAt });
    expect("privateMetric" in summary).toBe(false);
    expect(bytes(summary)).toBeLessThanOrEqual(4 * 1024);
  });

  it("truncates bounded fields and pages complete rule and report bodies", async () => {
    const value = sample();
    value.account.notes = "账户备注".repeat(500);
    value.account.holdings = Array.from({ length: 60 }, (_, index) => ({
      id: `holding-${index}`, symbol: `T${index}`, name: `合成持仓 ${index}`, account: "测试券商",
      currency: "USD", quantity: `${index + 1}.000000`, cost_total: null,
      value_usd: index % 2 ? "0" : null, valued_on: index % 2 ? "2026-10-01" : null,
      source: index % 2 ? "长来源".repeat(500) : "",
    }));
    value.account.cash = Array.from({ length: 40 }, (_, index) => ({
      id: `cash-${index}`, name: `合成余额 ${index}`, account: "测试券商", currency: "USD",
      amount: null, value_usd: null, confirmed_on: null, source: "现金来源".repeat(300),
    }));
    value.account.trades = Array.from({ length: 40 }, (_, index) => ({
      id: `trade-${index}`, date: "2026-10-01", account: "测试券商", kind: "buy" as const,
      symbol: "TEST", currency: "USD", quantity: "1", amount: "1", note: "流水备注".repeat(400),
    }));
    const ruleBody = `规则-${"规".repeat(8000)}-规则`;
    value.rules.body = ruleBody;
    const reportBody = `报告-${"报".repeat(12_000)}-报告`;
    value.reports = [{
      id: "report-large", title: "大报告", date: "2026-10-01", trading_date: null, date_source: "",
      kind: "复盘", summary: "长摘要".repeat(1000), body: reportBody,
      source: "报告来源".repeat(500), based_on_revision: null,
    }, {
      id: "report-two", title: "第二份报告", date: "2026-10-01", trading_date: null, date_source: "",
      kind: "复盘", summary: "摘要二", body: "第二份正文", source: "来源二", based_on_revision: null,
    }];
    await seed(value);

    for (const operation of ["portfolio", "cash", "trades", "reports"] as const) {
      const reply = await mcp().execute({
        subject: "kdp-owner", operation, args: { limit: operation === "reports" ? 20 : 50 },
      });
      expect(reply.ok).toBe(true);
      expect(bytes(reply)).toBeLessThanOrEqual(12 * 1024);
      if (reply.ok) expect(reply.data.truncation).toMatchObject({ truncated: true });
    }

    const pageOne = await mcp().execute({ subject: "kdp-owner", operation: "rules", args: {} });
    expect(pageOne.ok).toBe(true);
    if (!pageOne.ok) return;
    expect(bytes(pageOne)).toBeLessThanOrEqual(12 * 1024);
    expect(pageOne.data.page).toMatchObject({ unit: "characters", offset: 0, limit: 4000 });
    expect(pageOne.data.truncation).toMatchObject({ truncated: true });
    let ruleText = String((pageOne.data.rule as { body: string }).body);
    let ruleNext = (pageOne.data.page as { next_offset: number | null }).next_offset;
    let rulePages = 1;
    while (ruleNext !== null) {
      const next = await mcp().execute({
        subject: "kdp-owner", operation: "rules", args: { revision: 1, offset: ruleNext },
      });
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(bytes(next)).toBeLessThanOrEqual(12 * 1024);
      rulePages++;
      ruleText += String((next.data.rule as { body: string }).body);
      ruleNext = (next.data.page as { next_offset: number | null }).next_offset;
    }
    expect(ruleText).toBe(ruleBody);
    expect(rulePages).toBeLessThanOrEqual(3);

    let reportText = "";
    let reportOffset = 0;
    while (true) {
      const pageResult = await mcp().execute({
        subject: "kdp-owner", operation: "reports",
        args: { ...(reportOffset === 0 ? {} : { revision: 1 }), offset: reportOffset, limit: 10 },
      });
      expect(pageResult.ok).toBe(true);
      if (!pageResult.ok) return;
      expect(bytes(pageResult)).toBeLessThanOrEqual(12 * 1024);
      const reports = pageResult.data.reports as { id: string; body: string }[];
      if (reports.some(report => report.id === "report-large")) {
        reportText += reports.find(report => report.id === "report-large")?.body || "";
      }
      const pageInfo = pageResult.data.page as { next_offset: number | null };
      if (pageInfo.next_offset === null) break;
      reportOffset = pageInfo.next_offset;
    }
    expect(reportText).toBe(reportBody);
  });
});
