import type { Env, Dashboard } from "./types";
import { bodyJson, hash, json, object, ValidationError } from "./lib";
import { emptyWorkspace, type WorkspaceData, type WorkspaceView } from "./workspace-types";
import { validateWorkspace, valuation } from "./workspace-validation";

type Version = { revision: number; created_at: string; payload: string };

export async function workspaceActive(env: Env): Promise<boolean> {
  return Number(await env.DB.prepare("SELECT revision FROM gu_workspace_head WHERE singleton=1").first("revision")) > 0;
}

export async function readWorkspace(env: Env): Promise<WorkspaceView> {
  const row = await env.DB.prepare(`SELECT v.revision,v.created_at,v.payload FROM gu_workspace_head h
    JOIN gu_workspace_versions v ON h.revision=v.revision WHERE h.singleton=1`).first<Version>();
  const data = row ? JSON.parse(row.payload) as WorkspaceData : emptyWorkspace();
  return { active: !!row, revision: row?.revision || 0, updated_at: row?.created_at || null,
    data, valuation: valuation(data), materials_enabled: !!env.MATERIALS };
}

export async function previewWorkspace(request: Request) {
  const body = await bodyJson(request, 1_600_000);
  if (!object(body)) throw new ValidationError("预览内容无效");
  const data = validateWorkspace(body.data);
  if (body.imported === true) {
    for (const report of data.reports) {
      if (report.based_on_revision !== null) {
        report.source = `${report.source}${report.source ? "\n" : ""}导入文件的原工作台版本 ${report.based_on_revision}（不作为本环境版本引用）`;
        report.based_on_revision = null;
      }
    }
    validateWorkspace(data);
  }
  return json({ data, valuation: valuation(data) });
}

export async function saveWorkspace(request: Request, env: Env) {
  const body = await bodyJson(request, 1_600_000);
  if (!object(body) || body.confirmed !== true || !Number.isSafeInteger(body.base_revision) ||
      Number(body.base_revision) < 0 || typeof body.request_id !== "string" ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(body.request_id)) {
    throw new ValidationError("保存需要确认标记、有效的基础版本和请求 ID");
  }
  const data = validateWorkspace(body.data);
  if (data.reports.some(report => report.based_on_revision !== null && report.based_on_revision > Number(body.base_revision))) {
    throw new ValidationError("报告只能引用已存在的工作台版本");
  }
  const payload = JSON.stringify(data), digest = await hash(payload);
  const previous = await env.DB.prepare("SELECT revision,digest FROM gu_workspace_versions WHERE request_id=?")
    .bind(body.request_id).first<{ revision: number; digest: string }>();
  if (previous) {
    if (previous.digest !== digest || previous.revision !== Number(body.base_revision) + 1)
      return json({ error: "请求 ID 已用于其他内容，请重新预览" }, 409);
    return json({ ...await readWorkspace(env), saved_revision: previous.revision });
  }
  // A single D1 transaction allocates the next version only if the editor still owns the base.
  // The legacy pointer guard makes a reviewed import fail if another upload won the race.
  if (body.source_batch_id !== undefined && (typeof body.source_batch_id !== "string" || !/^[a-f0-9]{64}$/.test(body.source_batch_id)))
    throw new ValidationError("旧批次标识无效");
  const source = body.source_batch_id ?? null;
  const revision = Number(body.base_revision) + 1;
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO gu_workspace_versions(revision,request_id,digest,created_at,payload)
      SELECT revision+1,?,?,?,? FROM gu_workspace_head WHERE singleton=1 AND revision=?
      AND (? IS NULL OR ?=(SELECT batch_id FROM dashboard_current WHERE singleton=1))`)
      .bind(body.request_id, digest, new Date().toISOString(), payload, body.base_revision, source, source),
    env.DB.prepare(`UPDATE gu_workspace_head SET revision=? WHERE singleton=1 AND revision=?
      AND EXISTS(SELECT 1 FROM gu_workspace_versions WHERE revision=? AND request_id=? AND digest=?)`)
      .bind(revision, body.base_revision, revision, body.request_id, digest),
  ]);
  if (!result[1].meta.changes) {
    const retry = await env.DB.prepare("SELECT revision,digest FROM gu_workspace_versions WHERE request_id=?")
      .bind(body.request_id).first<{ revision: number; digest: string }>();
    if (retry?.digest === digest && retry.revision === revision)
      return json({ ...await readWorkspace(env), saved_revision: revision });
    return json({ error: "账户或来源批次已被更新。你的草稿仍保留，请导出草稿并重新读取后核对。", conflict: true }, 409);
  }
  return json({ ...await readWorkspace(env), saved_revision: revision });
}

export async function workspaceHistory(env: Env) {
  const rows = await env.DB.prepare("SELECT revision,created_at FROM gu_workspace_versions ORDER BY revision DESC LIMIT 100")
    .all<{ revision: number; created_at: string }>();
  return json({ versions: rows.results, limit: 100 });
}

export async function workspaceVersion(env: Env, raw: string) {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return json({ error: "版本不存在" }, 404);
  const row = await env.DB.prepare("SELECT revision,created_at,payload FROM gu_workspace_versions WHERE revision=?")
    .bind(Number(raw)).first<Version>();
  return row ? json({ revision: row.revision, created_at: row.created_at, data: JSON.parse(row.payload) })
    : json({ error: "版本不存在" }, 404);
}

export async function exportWorkspace(env: Env) {
  const workspace = await readWorkspace(env);
  const materials = await env.DB.prepare("SELECT id,name,content_type,size,sha256,created_at FROM gu_materials ORDER BY created_at,id").all();
  return json({ schema_version: 1, exported_at: new Date().toISOString(), revision: workspace.revision,
    data: workspace.data, materials: materials.results,
    attachment_note: "此文件包含资料索引，不包含原件；请在资料库下载原件。" }, 200,
  { "Content-Disposition": 'attachment; filename="gu-workspace.json"' });
}

function recordedDay(value: unknown): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) &&
    new Date(raw).toISOString().slice(0, 10) === raw ? raw : null;
}
function recordedDecimal(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1e12) return null;
  // Legacy JSON numbers can contain binary float tails; the online contract preserves six decimals.
  return value.toFixed(6).replace(/\.?0+$/, "") || "0";
}

export async function previewLegacy(env: Env) {
  if (await workspaceActive(env)) return json({ error: "已经启用线上账户；旧快照只保留作历史参考" }, 409);
  const row = await env.DB.prepare(`SELECT b.id,b.payload FROM dashboard_batches b JOIN dashboard_current c
    ON c.batch_id=b.id WHERE c.singleton=1`).first<{ id: string; payload: string }>();
  if (!row) return json({ error: "没有可导入的旧快照" }, 404);
  const old = JSON.parse(row.payload) as Dashboard, a = old.account?.[0];
  if (!a || a.data_mode !== "live") return json({ error: "只接受已标记 live 的旧快照；演示数据不能成为正式账户" }, 400);
  const data = emptyWorkspace();
  data.account.confirmed_on = recordedDay(a.holdings_as_of);
  data.account.notes = "从旧看板导入。未迁入完整券商账户、原币成本、交易历史或可执行规则，请核实后补充。";
  data.account.holdings = old.positions.filter(p => p.ticker !== "现金").map((p, index) => ({
    id: `legacy-holding-${index}`, symbol: String(p.ticker), name: String(p.name), account: "",
    currency: null, quantity: recordedDecimal(p.shares), cost_total: null,
    value_usd: recordedDay(p.quote_date) ? recordedDecimal(p.value_usd) : null,
    valued_on: recordedDay(p.quote_date), source: `旧看板 ${row.id.slice(0, 12)}；未重新采集`,
  }));
  const cashDate = recordedDay(a.cash_as_of);
  data.account.cash = [{ id: "legacy-cash", name: "旧快照现金与基金合计（待拆分）", account: "", currency: null,
    amount: null, value_usd: cashDate ? recordedDecimal(a.cash_usd) : null, confirmed_on: cashDate,
    source: `旧看板 ${row.id.slice(0, 12)}；合计参考估值，不代表已确认的原币现金` }];
  data.rules.body = "";
  data.reports = old.reports.map((r, index) => ({
    id: `legacy-report-${index}`, title: String(r.headline || r.kind || "历史报告").slice(0, 200),
    date: String(r.date), kind: String(r.kind), summary: String(r.headline || ""), body: String(r.body),
    trading_date: r.trading_date == null ? null : String(r.trading_date),
    date_source: r.date_source == null ? "" : String(r.date_source),
    source: `${String(r.path)}\n旧看板批次 ${row.id}；原报告 ${String(r.id)}`, based_on_revision: null,
  }));
  const parsed = validateWorkspace(data);
  return json({ data: parsed, valuation: valuation(parsed), source_batch_id: row.id,
    warnings: ["股数沿用旧记录，原币成本与完整交易流水缺失。", "旧风控结果没有迁成新规则，请录入原投资规范。", "旧现金合计包含基金，导入后请核对并拆分。"] });
}
