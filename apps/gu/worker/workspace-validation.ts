import { object, ValidationError } from "./lib";
import type { WorkspaceData, Valuation } from "./workspace-types";

const fail = (message: string): never => { throw new ValidationError(message); };
const record = (v: unknown) => object(v) ? v : fail("需要对象格式的数据");
const text = (v: unknown, name: string, max = 300, required = false): string =>
  typeof v === "string" && v.length <= max && (!required || v.trim().length > 0)
    ? v.trim() : fail(`${name}格式无效或过长`);
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v)
  ? v : fail("记录 ID 无效");

export function date(v: unknown, nullable = true): string | null {
  if (nullable && v === null) return null;
  // Calendar dates follow Asia/Shanghai, matching the editor.
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v &&
    v <= new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
    ? v : fail("日期必须是有效的已发生日期");
}

function decimal(v: unknown, nullable = true): string | null {
  if (nullable && v === null) return null;
  if (typeof v !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(v))
    return fail("金额和数量须为非负十进制文本，最多 12 位整数、6 位小数");
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

function currency(v: unknown, nullable = true): string | null {
  if (nullable && v === null) return null;
  return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : fail("币种须为三位大写代码");
}

function rows<T>(v: unknown, max: number, parse: (v: Record<string, unknown>) => T & { id: string }): T[] {
  if (!Array.isArray(v) || v.length > max) return fail(`记录数量不能超过 ${max}`);
  const parsed = v.map(item => parse(record(item)));
  if (new Set(parsed.map(item => item.id)).size !== parsed.length) fail("同类记录 ID 不能重复");
  return parsed;
}

export function validateWorkspace(value: unknown): WorkspaceData {
  const v = record(value), a = record(v.account), r = record(v.rules);
  const data: WorkspaceData = {
    account: {
      name: text(a.name, "账户名称", 100, true), confirmed_on: date(a.confirmed_on),
      notes: text(a.notes, "账户备注", 10000),
      holdings: rows(a.holdings, 200, p => ({
        id: id(p.id), symbol: text(p.symbol, "标的", 40, true), name: text(p.name, "名称", 150, true),
        account: text(p.account, "所属账户", 100), currency: currency(p.currency),
        quantity: decimal(p.quantity), cost_total: decimal(p.cost_total),
        value_usd: decimal(p.value_usd), valued_on: date(p.valued_on), source: text(p.source, "估值来源", 1000),
      })),
      cash: rows(a.cash, 100, c => ({
        id: id(c.id), name: text(c.name, "余额名称", 150, true), account: text(c.account, "所属账户", 100),
        currency: currency(c.currency), amount: decimal(c.amount), value_usd: decimal(c.value_usd),
        confirmed_on: date(c.confirmed_on), source: text(c.source, "余额来源", 1000),
      })),
      trades: rows(a.trades, 2000, t => {
        if (!["buy", "sell", "deposit", "withdrawal", "dividend", "fee"].includes(String(t.kind)))
          fail("交易类型无效");
        const kind = t.kind as WorkspaceData["account"]["trades"][number]["kind"];
        const quantity = decimal(t.quantity);
        const symbol = text(t.symbol, "交易标的", 40);
        if (["buy", "sell"].includes(kind) && (!symbol || quantity === null || Number(quantity) <= 0))
          fail("买卖记录需要标的和大于零的数量");
        return { id: id(t.id), date: date(t.date, false)!, account: text(t.account, "所属账户", 100),
          kind, symbol, currency: currency(t.currency, false)!, quantity,
          amount: decimal(t.amount, false)!, note: text(t.note, "交易备注", 2000) };
      }),
    },
    rules: { title: text(r.title, "规则名称", 150, true), body: text(r.body, "规则正文", 100000) },
    reports: rows(v.reports, 500, p => {
      if (p.based_on_revision !== null && (!Number.isSafeInteger(p.based_on_revision) || Number(p.based_on_revision) < 1))
        fail("报告依据版本无效");
      return { id: id(p.id), title: text(p.title, "报告标题", 200, true), date: date(p.date, false)!,
        trading_date: p.trading_date === undefined ? null : date(p.trading_date),
        date_source: p.date_source === undefined ? "" : text(p.date_source, "日期来源", 100),
        kind: text(p.kind, "报告类型", 100, true), summary: text(p.summary, "报告摘要", 10000),
        body: text(p.body, "报告正文", 500000, true), source: text(p.source, "报告来源", 2000),
        based_on_revision: p.based_on_revision as number | null };
    }),
  };
  for (const p of data.account.holdings) {
    if (p.value_usd !== null && (!p.valued_on || !p.source)) fail("参考估值必须注明日期和来源");
    if (p.cost_total !== null && !p.currency) fail("成本必须注明原币种");
  }
  for (const c of data.account.cash) {
    if (c.amount !== null && !c.currency) fail("原币余额必须注明币种");
    if (c.value_usd !== null && (!c.confirmed_on || !c.source)) fail("余额估值必须注明确认日期和来源");
  }
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 1_500_000) fail("工作台内容超过 1.5 MB，请精简正文或使用资料附件");
  return data;
}

function micros(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
function amount(value: bigint): string {
  const whole = value / 1_000_000n, fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
}

export function valuation(data: WorkspaceData): Valuation {
  const entries = [...data.account.holdings.map(p => ({ value: p.value_usd, date: p.valued_on })),
    ...data.account.cash.map(c => ({ value: c.value_usd, date: c.confirmed_on }))];
  const missing = entries.filter(e => e.value === null).length;
  const known = amount(entries.reduce((sum, e) => sum + (e.value === null ? 0n : micros(e.value)), 0n));
  const dates = entries.filter(e => e.value !== null && e.date).map(e => e.date!).sort();
  const warnings = [];
  if (!data.account.confirmed_on) warnings.push("尚未确认账户快照日期。");
  if (!entries.length) warnings.push("尚未录入持仓或余额，无法计算账户估值。");
  if (missing) warnings.push(`${missing} 项缺少参考估值，不能将已知小计作为总资产。`);
  if (new Set(dates).size > 1) warnings.push("参考估值来自不同日期，合计不代表同一时刻的资产。");
  if (dates[0] && Date.now() - Date.parse(dates[0]) > 7 * 86400_000) warnings.push("至少一项参考估值超过 7 天，请核对来源。");
  warnings.push("参考估值为已录入的 USD 金额；本阶段尚未自动采集行情或执行投资规则。");
  return { total_usd: entries.length && !missing ? known : null, known_usd: known,
    missing, entries: entries.length, oldest_date: dates[0] || null, warnings };
}
