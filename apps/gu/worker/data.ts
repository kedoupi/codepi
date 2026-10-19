import type { Dashboard, Env, Row } from "./types";
import { bodyJson, equal, hash, json, object, ValidationError } from "./lib";
import { readWorkspace, workspaceActive } from "./workspace";

const KEYS = ["account", "positions", "risk", "market", "reports"];
const KEYS_V2 = [...KEYS, "history"];
const day = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const text = (r: Row, keys: string[]) => keys.every(k => typeof r[k] === "string");
const optionalNumber = (v: unknown) => v === null || numeric(v);
const optionalText = (v: unknown) => v === null || typeof v === "string";
const optionalRatio = (r: Row, key: string) => r[key] === undefined || r[key] === null ||
  (numeric(r[key]) && Number(r[key]) >= 0 && Number(r[key]) <= 1);
const optionalInstant = (r: Row, key: string) => r[key] === undefined || r[key] === null ||
  (typeof r[key] === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(r[key]) && Number.isFinite(Date.parse(r[key])));

function quoteFields(row: Row) {
  return ["quote_time", "market_time_iso", "bar_time"].every(k => optionalInstant(row, k))
    && (row.quote_time_status === undefined || ["confirmed", "unconfirmed"].includes(String(row.quote_time_status)))
    && (row.quote_session === undefined || ["unconfirmed", "pre", "regular", "post", "closed"].includes(String(row.quote_session)));
}

export function validateDashboard(value: unknown, schemaVersion = 2): asserts value is Dashboard {
  const keys = schemaVersion >= 2 ? KEYS_V2 : KEYS;
  if (!object(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new ValidationError("需要完整的数据批次");
  for (const k of keys) {
    if (!Array.isArray(value[k]) || (value[k] as unknown[]).length > 2000 ||
      !(value[k] as unknown[]).every(object)) throw new ValidationError(`数据格式无效：${k}`);
  }
  const data = value as unknown as Dashboard;
  if (data.account.length !== 1 || !data.positions.length || !data.risk.length) throw new ValidationError("账户、持仓或风控为空");
  const a = data.account[0];
  if (a.data_mode !== "live") throw new ValidationError("正式看板只接受明确标记 live 的数据，请重新联网生成");
  if (!text(a, ["generated_at", "framework", "cash_as_of", "warnings"]) ||
    !day(a.holdings_as_of) || !day(a.quote_date) ||
    !["total_usd", "stocks_usd", "hk_usd", "cash_usd", "cash_weight", "cash_after_dca", "cash_age_days"].every(k => numeric(a[k])) ||
    Number(a.total_usd) <= 0 || !/(Z|[+-]\d{2}:\d{2})$/.test(String(a.generated_at)) ||
    !Number.isFinite(Date.parse(String(a.generated_at))) ||
    Date.parse(String(a.generated_at)) > Date.now() + 300_000) throw new ValidationError("账户数据或生成时间无效");
  if (!optionalRatio(a, "cash_weight_raw") ||
    (a.cash_after_dca_raw !== undefined && !numeric(a.cash_after_dca_raw)) ||
    !["quote_time_min", "quote_time_max", "market_time_min", "market_time_max"].every(k => optionalInstant(a, k)) ||
    (a.dca_amount_usd !== undefined && (!numeric(a.dca_amount_usd) || Number(a.dca_amount_usd) < 0))) {
    throw new ValidationError("账户新增精度或时间字段无效");
  }
  const unique = (rows: Row[], key: string) => new Set(rows.map(r => r[key])).size === rows.length;
  if (!unique(data.positions, "ticker") || !unique(data.risk, "rule_id") ||
    !unique(data.market, "symbol") || !unique(data.reports, "id")) throw new ValidationError("数据包含重复标识");
  for (const p of data.positions) {
    if (!text(p, ["ticker", "name", "quote_date"]) || !numeric(p.value_usd) || !numeric(p.weight) ||
      !["shares", "avg_cost", "price", "change_pct", "pnl_pct", "target"].every(k => optionalNumber(p[k]))) throw new ValidationError("持仓数据无效");
    if (!optionalRatio(p, "weight_raw") || !quoteFields(p)) throw new ValidationError("持仓新增精度或时间字段无效");
    if (p.shares !== null && (!numeric(p.price) || Number(p.price) <= 0 || !day(p.quote_date))) throw new ValidationError("持仓行情缺失");
  }
  for (const r of data.risk) {
    if (!text(r, ["rule_id", "item", "kind", "current", "threshold", "level", "proximity"]) ||
      !optionalText(r.action) || !(r.triggered === null || typeof r.triggered === "boolean") ||
      !optionalNumber(r.distance) ||
      (numeric(r.distance) && Number(r.distance) < 0)) throw new ValidationError("风控数据缺少明确规则状态，请重新生成");
    if ((r.current_value !== undefined && !optionalNumber(r.current_value)) ||
      (r.current_unit !== undefined && !["ratio", "USD"].includes(String(r.current_unit)))) throw new ValidationError("风控原始数值字段无效");
  }
  for (const m of data.market) {
    if (!text(m, ["symbol", "name", "group", "date"]) || !optionalNumber(m.close) ||
      !optionalNumber(m.change_pct) || !(m.error === null || typeof m.error === "string") ||
      (!m.error && (!numeric(m.close) || Number(m.close) <= 0 || !day(m.date)))) throw new ValidationError("行情缺失时必须记录错误");
    if (!quoteFields(m)) throw new ValidationError("行情时间字段无效");
  }
  if (schemaVersion >= 2) {
    const history = data.history;
    if (!history?.length) throw new ValidationError("权重历史为空");
    for (const h of history) {
      const weights = h.weights;
      if (!day(h.date) || !text(h, ["source"]) || typeof h.approx !== "boolean" || !object(weights)) {
        throw new ValidationError("权重历史格式无效");
      }
      const entries = Object.entries(weights as Record<string, unknown>);
      if (!entries.length || entries.length > 20) throw new ValidationError("权重历史条目无效");
      for (const [ticker, value] of entries) {
        if (!ticker || !numeric(value) || !(Number(value) > 0 && Number(value) <= 1)) {
          throw new ValidationError("权重历史取值无效");
        }
      }
      if (h.weights_raw !== undefined) {
        if (!object(h.weights_raw) || Object.keys(h.weights_raw).sort().join() !== Object.keys(weights).sort().join() ||
          !Object.keys(h.weights_raw).every(k => optionalRatio(h.weights_raw as Row, k) && numeric((h.weights_raw as Row)[k]))) {
          throw new ValidationError("历史原始权重字段无效");
        }
      }
    }
  }
  for (const r of data.reports) {
    if (!text(r, ["id", "kind", "headline", "action", "rule", "body", "path", "date_source"]) ||
      !day(r.date) || !(r.trading_date === null || day(r.trading_date)) ||
      !/^reports\/\d{4}-\d{2}\/[^/\\]+\.md$/.test(String(r.path)) ||
      String(r.body).length > 500_000) throw new ValidationError("报告格式无效");
  }
}

export async function upload(request: Request, env: Env) {
  const provided = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (!env.UPLOAD_TOKEN || !provided || !equal(await hash(provided), await hash(env.UPLOAD_TOKEN))) {
    return json({ error: "同步凭证无效" }, 401);
  }
  if (await workspaceActive(env)) return json({ error: "已启用线上账户，旧批次上传已停用" }, 409);
  const envelope = await bodyJson(request);
  if (!object(envelope) || (envelope.schema_version !== 1 && envelope.schema_version !== 2) ||
    typeof envelope.payload !== "string" ||
    typeof envelope.batch_id !== "string" || !/^[a-f0-9]{64}$/.test(envelope.batch_id)) {
    return json({ error: "同步包格式无效" }, 400);
  }
  const id = await hash(envelope.payload);
  if (!equal(id, envelope.batch_id)) return json({ error: "批次校验失败" }, 400);
  const data: unknown = JSON.parse(envelope.payload);
  validateDashboard(data, envelope.schema_version);
  const generated = new Date(String(data.account[0].generated_at)).toISOString();
  // Both statements commit together. The conditional pointer prevents concurrent stale uploads.
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO dashboard_batches (id, generated_at, received_at, payload) VALUES (?, ?, ?, ?)")
      .bind(id, generated, new Date().toISOString(), envelope.payload),
    env.DB.prepare(`INSERT INTO dashboard_current (singleton, batch_id)
      SELECT 1, ? WHERE (SELECT revision FROM gu_workspace_head WHERE singleton=1)=0
      ON CONFLICT(singleton) DO UPDATE SET batch_id = excluded.batch_id
      WHERE (SELECT generated_at FROM dashboard_batches WHERE id = dashboard_current.batch_id) < ?
        OR dashboard_current.batch_id = excluded.batch_id`).bind(id, generated),
  ]);
  const current = await env.DB.prepare("SELECT batch_id FROM dashboard_current WHERE singleton = 1").first<{ batch_id: string }>();
  if (await workspaceActive(env)) return json({ error: "已启用线上账户，旧批次未成为线上数据" }, 409);
  if (current?.batch_id !== id) return json({ error: "已有更新或同时间的不同批次，未替换当前数据" }, 409);
  return json({ ok: true, batch_id: id, generated_at: generated });
}

export async function dashboard(env: Env, request?: Request) {
  const workspace = await readWorkspace(env);
  if (workspace.active) {
    return request?.headers.get("X-GU-Workspace") === "1" ? json({ mode: "online", workspace })
      : json({ error: "已切换线上账户，请重新加载页面", online: true }, 409);
  }
  const row = await env.DB.prepare(`SELECT b.id, b.generated_at, b.received_at, b.payload FROM dashboard_batches b
    JOIN dashboard_current c ON c.batch_id = b.id WHERE c.singleton = 1`)
    .first<{ id: string; generated_at: string; received_at: string; payload: string }>();
  if (!row) return json({ error: "尚未同步投资数据", empty: true }, 404);
  return json({ batch_id: row.id, received_at: row.received_at, data: JSON.parse(row.payload) });
}
