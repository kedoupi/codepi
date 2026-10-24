import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hash, secretHash } from "../worker/lib";
import { emptyWorkspace, type WorkspaceData } from "../worker/workspace-types";
import { date, validateWorkspace, valuation } from "../worker/workspace-validation";
import type { Env } from "../worker/types";

const origin = "https://gu.test", session = "synthetic-online-session";
const headers = { Cookie: `__Host-gu_session=${session}`, Origin: origin, "Content-Type": "application/json", "X-GU-Workspace": "1" };
const day = "2026-10-01";
const requestId = () => crypto.randomUUID();
function data(): WorkspaceData {
  const value = emptyWorkspace();
  value.account.confirmed_on = day;
  value.account.holdings = [{ id: "holding-test", symbol: "TEST", name: "合成测试持仓", account: "测试券商",
    currency: "USD", quantity: "10", cost_total: "50", value_usd: "0.1", valued_on: day, source: "合成测试估值" }];
  value.account.cash = [{ id: "cash-test", name: "合成测试余额", account: "测试券商", currency: "USD",
    amount: "0.2", value_usd: "0.2", confirmed_on: day, source: "合成测试结单" }];
  return value;
}
async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", bindings: Env = env) {
  return worker.fetch(new Request(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), bindings);
}
const save = (value = data(), base = 0, id = requestId(), extra = {}) =>
  call("/api/workspace", { data: value, base_revision: base, request_id: id, confirmed: true, ...extra }, "PUT");

beforeEach(async () => {
  await env.DB.exec(`UPDATE gu_workspace_head SET revision=0; DELETE FROM gu_workspace_versions;
    DELETE FROM gu_materials; DELETE FROM dashboard_current; DELETE FROM dashboard_batches; DELETE FROM sessions;`);
  await env.DB.prepare("INSERT INTO sessions(id,expires_at) VALUES(?,?)")
    .bind(await secretHash(session, env.SESSION_SECRET!), Date.now() + 3600_000).run();
  const stored = await env.MATERIALS!.list();
  if (stored.objects.length) await env.MATERIALS!.delete(stored.objects.map(o => o.key));
});

describe("online account validation and valuation", () => {
  it("rejects future dates until midnight in the account's Asia/Shanghai timezone", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T12:00:00Z"));
    try {
      expect(date("2026-10-19")).toBe("2026-10-19");
      expect(() => date("2026-10-20")).toThrow("日期必须是有效的已发生日期");
      clock.mockReturnValue(Date.parse("2026-10-19T16:00:00Z"));
      expect(date("2026-10-20")).toBe("2026-10-20");
    } finally {
      clock.mockRestore();
    }
  });
  it("sums decimal amounts exactly and distinguishes missing from zero", () => {
    expect(valuation(validateWorkspace(data())).total_usd).toBe("0.3");
    const d = data(); d.account.holdings[0].value_usd = null;
    expect(valuation(d)).toMatchObject({ total_usd: null, known_usd: "0.2", missing: 1 });
    d.account.holdings[0].value_usd = "0";
    expect(valuation(d)).toMatchObject({ total_usd: "0.2", missing: 0 });
    expect(valuation(emptyWorkspace()).total_usd).toBeNull();
  });
  it("rejects invalid dates, precision, duplicates and unsupported values", async () => {
    const invalid = [
      (d: WorkspaceData) => { d.account.holdings[0].value_usd = "-1"; },
      (d: WorkspaceData) => { d.account.holdings[0].value_usd = "1e9"; },
      (d: WorkspaceData) => { d.account.holdings[0].value_usd = "0.0000001"; },
      (d: WorkspaceData) => { d.account.holdings[0].value_usd = 10 as unknown as string; },
      (d: WorkspaceData) => { d.account.holdings[0].valued_on = "2026-02-31"; },
      (d: WorkspaceData) => { d.account.holdings[0].valued_on = "2099-01-01"; },
      (d: WorkspaceData) => { d.account.holdings[0].source = ""; },
      (d: WorkspaceData) => { d.account.holdings[0].currency = null; },
      (d: WorkspaceData) => { d.account.holdings.push({ ...d.account.holdings[0] }); },
    ];
    for (const mutate of invalid) {
      const d = data(); mutate(d);
      expect((await save(d)).status).toBe(400);
    }
    expect((await (await call("/api/workspace")).json() as { revision: number }).revision).toBe(0);
  });
  it("records trades without inventing position or cash changes", async () => {
    const d = data();
    d.account.trades.push({ id: "trade-test", account: "测试券商", date: day, kind: "buy", symbol: "TEST",
      currency: "USD", quantity: "2", amount: "4", note: "合成测试流水" });
    expect((await save(d)).status).toBe(200);
    const result = await (await call("/api/workspace")).json() as { data: WorkspaceData };
    expect(result.data.account.holdings[0].quantity).toBe("10");
    expect(result.data.account.cash[0].amount).toBe("0.2");
    const invalid = data(); invalid.account.trades = [{ ...d.account.trades[0], quantity: "0" }];
    expect((await save(invalid, 1)).status).toBe(400);
  });
});

describe("immutable versions and concurrent writers", () => {
  it("previews without writing and requires confirmation before enabling", async () => {
    expect((await call("/api/workspace/preview", { data: data() })).status).toBe(200);
    expect((await (await call("/api/workspace")).json() as { active: boolean }).active).toBe(false);
    expect((await save(data(), 0, requestId(), { confirmed: false })).status).toBe(400);
    expect((await save()).status).toBe(200);
    const state = await (await call("/api/workspace")).json();
    expect(state).toMatchObject({ active: true, revision: 1, valuation: { total_usd: "0.3" } });
  });
  it("commits once under a retried request and rejects reusing its key", async () => {
    const id = requestId(), d = data();
    const results = await Promise.all([save(d, 0, id), save(d, 0, id)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_workspace_versions").first("n")).toBe(1);
    d.account.name = "不同内容";
    expect((await save(d, 0, id)).status).toBe(409);
  });
  it("lets only one concurrent editor advance a version", async () => {
    const first = data(), second = data();
    second.account.name = "第二个窗口";
    const results = await Promise.all([save(first), save(second)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_workspace_versions").first("n")).toBe(1);
  });
  it("retains historical rules and report provenance after an update", async () => {
    const d = data(); d.rules.body = "合成规则 v1";
    await save(d);
    d.rules.body = "合成规则 v2";
    d.reports = [{ id: "report-test", title: "合成测试报告", date: day, kind: "复盘", summary: "",
      trading_date: "2026-09-30", date_source: "front_matter",
      body: "# 合成报告", source: "", based_on_revision: 1 }];
    expect((await save(d, 1)).status).toBe(200);
    const old = await (await call("/api/workspace/versions/1")).json() as { data: WorkspaceData };
    expect(old.data.rules.body).toBe("合成规则 v1");
    expect(old.data.reports).toEqual([]);
    expect((await (await call("/api/workspace/history")).json() as { versions: unknown[] }).versions).toHaveLength(2);
    d.reports[0].based_on_revision = 999;
    expect((await save(d, 2)).status).toBe(400);
    const exported = await call("/api/workspace/export");
    expect(exported.headers.get("Content-Disposition")).toContain("attachment");
    expect(await exported.json()).toMatchObject({ schema_version: 1, revision: 2,
      data: { reports: [{ based_on_revision: 1, trading_date: "2026-09-30", date_source: "front_matter" }] }, materials: [] });
  });
  it("imports an export into a fresh workspace without inventing local version provenance", async () => {
    const d = data();
    d.reports = [{ id: "old-report", title: "导入测试", date: day, kind: "复盘", summary: "",
      trading_date: "2026-09-30", date_source: "filename",
      body: "合成内容", source: "合成来源", based_on_revision: 42 }];
    const response = await call("/api/workspace/preview", { data: d, imported: true });
    expect(response.status).toBe(200);
    const imported = await response.json() as { data: WorkspaceData };
    expect(imported.data.reports[0].based_on_revision).toBeNull();
    expect(imported.data.reports[0].source).toContain("原工作台版本 42");
    expect(imported.data.reports[0]).toMatchObject({ trading_date: "2026-09-30", date_source: "filename" });
    expect((await save(imported.data)).status).toBe(200);
  });
  it("switches both dashboard and Desk to online data without stale risk claims", async () => {
    await save();
    expect(await (await call("/api/dashboard")).json()).toMatchObject({ mode: "online", workspace: { revision: 1 } });
    const outdated = await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: headers.Cookie } }), env);
    expect(outdated.status).toBe(409);
    const summary = await worker.fetch(new Request(origin + "/api/internal/desk-summary", {
      headers: { Authorization: "Bearer synthetic-desk-token-with-enough-length" },
    }), { ...env, DESK_SUMMARY_TOKEN: "synthetic-desk-token-with-enough-length" });
    expect(await summary.json()).toMatchObject({ source: "gu", privateMetric: { value: "0.3" } });
    const upload = await worker.fetch(new Request(origin + "/api/sync", { method: "PUT",
      headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}`, "Content-Type": "application/json" }, body: "{}" }), env);
    expect(upload.status).toBe(409);
  });
});

describe("legacy migration preview", () => {
  async function seed() {
    const value = { account: [{ data_mode: "live", holdings_as_of: day, cash_as_of: day, cash_usd: 0.2 }],
      positions: [{ ticker: "TEST", name: "测试", shares: 10, value_usd: 0.1, quote_date: day },
        { ticker: "现金", name: "现金", value_usd: 0.2, quote_date: day }],
      reports: [{ id: "old", headline: "历史合成报告", kind: "复盘", body: "# 测试", date: day,
        trading_date: "2026-09-30", date_source: "front_matter", path: "reports/2026-10/test.md" }],
      risk: [{ rule_id: "old-result", triggered: true }] };
    const payload = JSON.stringify(value), id = await hash(payload);
    await env.DB.prepare("INSERT INTO dashboard_batches VALUES(?,?,?,?)").bind(id, day, day, payload).run();
    await env.DB.prepare("INSERT INTO dashboard_current VALUES(1,?)").bind(id).run();
    return id;
  }
  it("copies only supported facts, retaining unknowns and preserving reports", async () => {
    const id = await seed();
    const result = await (await call("/api/workspace/import-legacy", {})).json() as { data: WorkspaceData; source_batch_id: string };
    expect(result.source_batch_id).toBe(id);
    expect(result.data.account.holdings).toHaveLength(1);
    expect(result.data.account.holdings[0]).toMatchObject({ quantity: "10", value_usd: "0.1", currency: null, cost_total: null });
    expect(result.data.account.cash[0]).toMatchObject({ amount: null, currency: null, value_usd: "0.2" });
    expect(result.data.rules.body).toBe("");
    expect(result.data.reports[0].body).toBe("# 测试");
    expect(result.data.reports[0]).toMatchObject({ date: day, trading_date: "2026-09-30", date_source: "front_matter" });
    expect(result.data.reports[0].source).toContain(id);
    expect(result.data.reports[0].source).toContain("reports/2026-10/test.md");
    expect((await save(result.data, 0, requestId(), { source_batch_id: id })).status).toBe(200);
    expect(await (await call("/api/workspace/export")).json()).toMatchObject({
      data: { reports: [{ date: day, trading_date: "2026-09-30", date_source: "front_matter" }] },
    });
    expect((await call("/api/workspace/import-legacy", {})).status).toBe(409);
  });
  it("rejects confirmation if the reviewed source was replaced", async () => {
    await seed();
    const result = await (await call("/api/workspace/import-legacy", {})).json() as { data: WorkspaceData };
    expect((await save(result.data, 0, requestId(), { source_batch_id: "a".repeat(64) })).status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_workspace_versions").first("n")).toBe(0);
  });
});

describe("private materials and API gates", () => {
  it.each(["/api/workspace", "/api/workspace/export", "/api/workspace/history",
    "/api/workspace/versions/1", "/api/materials", "/api/materials/unknown"])("requires a session for %s", async path => {
    expect((await worker.fetch(new Request(origin + path), env)).status).toBe(401);
    expect((await worker.fetch(new Request(origin + path, { headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` } }), env)).status).toBe(401);
    expect((await worker.fetch(new Request(origin + path, { method: "HEAD", headers }), env)).status).toBe(404);
  });
  it("rejects cross-site writes and legacy OTP sessions when SSO is enabled", async () => {
    const response = await worker.fetch(new Request(origin + "/api/workspace", { method: "PUT",
      headers: { ...headers, Origin: "https://evil.test" }, body: "{}" }), env);
    expect(response.status).toBe(403);
    expect((await call("/api/workspace", undefined, "GET", { ...env, SSO_ENABLED: "1",
      AUTH_CLIENT_ID: "gu", AUTH_CLIENT_SECRET: "synthetic-sso-secret", AUTH_ORIGIN: "https://auth.codepi.app",
      AUTH: { fetch: async () => Response.json({ active: false }) } as unknown as Fetcher,
    })).status).toBe(401);
  });
  async function upload(name = "synthetic.md", body = "# Synthetic material", bindings: Env = env) {
    const form = new FormData(); form.append("file", new File([body], name));
    return worker.fetch(new Request(origin + "/api/materials", { method: "POST",
      headers: { Cookie: headers.Cookie, Origin: origin }, body: form }), bindings);
  }
  it("stores private files once and returns authenticated attachment downloads", async () => {
    const uploaded = await upload();
    expect(uploaded.status).toBe(201);
    const { material } = await uploaded.json() as { material: { id: string } };
    expect((await upload()).status).toBe(200);
    expect((await env.MATERIALS!.list()).objects).toHaveLength(1);
    const file = await call(`/api/materials/${material.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("Cache-Control")).toBe("no-store");
    expect(file.headers.get("Content-Disposition")).toContain("attachment;");
    expect(await file.text()).toBe("# Synthetic material");
    expect(await (await call("/api/workspace")).json()).toMatchObject({ active: false });
    expect((await worker.fetch(new Request(origin + `/api/materials/${material.id}`), env)).status).toBe(401);
  });
  function uncertainInsert(committed: boolean): Env {
    const DB = new Proxy(env.DB, { get(target, property) {
      if (property === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("INSERT OR IGNORE INTO gu_materials")) return statement;
        return { bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return { async run() {
            if (committed) await bound.run();
            throw new Error("Synthetic acknowledgement failure");
          } };
        } };
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    return { ...env, DB };
  }
  it("keeps the original after a committed D1 insert loses its acknowledgement", async () => {
    expect((await upload("synthetic.md", "# Synthetic material", uncertainInsert(true))).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_materials").first("n")).toBe(1);
    expect((await env.MATERIALS!.list()).objects).toHaveLength(1);
    const retried = await upload();
    expect(retried.status).toBe(200);
    const body = await retried.json() as { material: { id: string; object_key?: string }; duplicate: boolean };
    expect(body.duplicate).toBe(true);
    expect(body.material.object_key).toBeUndefined();
    expect(await (await call(`/api/materials/${body.material.id}`)).text()).toBe("# Synthetic material");
  });
  it("retains an original for reconciliation when D1 commit status cannot be established", async () => {
    expect((await upload("synthetic.md", "# Synthetic material", uncertainInsert(false))).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_materials").first("n")).toBe(0);
    expect((await env.MATERIALS!.list()).objects).toHaveLength(1);
    expect(await (await call("/api/workspace")).json()).toMatchObject({ active: false });
  });
  it("repairs a missing original by concurrent reuploads without changing its identity", async () => {
    const first = await (await upload()).json() as { material: { id: string } };
    const key = await env.DB.prepare("SELECT object_key FROM gu_materials WHERE id=?").bind(first.material.id).first<string>("object_key");
    await env.MATERIALS!.delete(key!);
    expect((await call(`/api/materials/${first.material.id}`)).status).toBe(503);
    const retried = await Promise.all([upload("renamed.md"), upload()]);
    for (const response of retried) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ duplicate: true, material: { id: first.material.id, name: "synthetic.md" } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_materials").first("n")).toBe(1);
    expect((await env.MATERIALS!.list()).objects).toHaveLength(1);
    expect(await (await call(`/api/materials/${first.material.id}`)).text()).toBe("# Synthetic material");
  });
  it("keeps a single downloadable original under concurrent first uploads", async () => {
    const responses = await Promise.all([upload(), upload()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map(r => r.json())) as { material: { id: string } }[];
    expect(bodies[0].material.id).toBe(bodies[1].material.id);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_materials").first("n")).toBe(1);
    expect((await env.MATERIALS!.list()).objects).toHaveLength(1);
    expect((await call(`/api/materials/${bodies[0].material.id}`)).status).toBe(200);
  });
  it("paginates materials beyond the first 500 records", async () => {
    for (let i = 0; i < 501; i++) {
      const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      await env.DB.prepare("INSERT INTO gu_materials(id,object_key,name,content_type,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(id, `materials/${id}`, `material-${i}.txt`, "text/plain", 1, `${String(i).padStart(64, "0")}`, `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`).run();
    }
    const first = await call("/api/materials");
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { materials: { id: string }[]; next_offset?: number | null };
    expect(firstBody.materials).toHaveLength(500);
    expect(firstBody.next_offset).toBe(500);
    const second = await call("/api/materials?offset=500");
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { materials: { id: string }[]; next_offset?: number | null };
    expect(secondBody.materials).toHaveLength(1);
    expect(secondBody.next_offset).toBeNull();
    expect(new Set([...firstBody.materials, ...secondBody.materials]).size).toBe(501);
  });
  it.each(["-1", "1.5", "abc", "", "9007199254740992"])("rejects invalid material offsets: %s", async offset => {
    const response = await call(`/api/materials?offset=${encodeURIComponent(offset)}`);
    expect(response.status).toBe(400);
  });
  it("rejects executable extensions, misleading file signatures, oversize and unconfigured storage", async () => {
    for (const name of ["test.html", "test.svg", "test.pdf", "test.png", "test.jpg"])
      expect((await upload(name)).status).toBe(400);
    expect((await upload("large.txt", "a".repeat(8 * 1024 * 1024 + 1))).status).toBe(400);
    expect((await upload("test.txt", "test", { ...env, MATERIALS: undefined })).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM gu_materials").first("n")).toBe(0);
  });
});
