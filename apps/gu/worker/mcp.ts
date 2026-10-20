import { WorkerEntrypoint } from "cloudflare:workers";
import { emptySummary, type DeskSummary } from "@kedoupi/shared/desk/contract";
import {
  GU_OPERATIONS,
  MCP_LIMITS,
  type DomainReply,
  type DomainRequest,
  type GuOperation,
  type GuService,
  type SourceSummary,
} from "@kedoupi/shared/mcp/contract";
import { onlineWorkspaceSummary } from "./desk-summary";
import type { Env } from "./types";
import { readWorkspace } from "./workspace";
import type {
  CashBalance,
  Holding,
  ResearchReport,
  Trade,
  WorkspaceView,
} from "./workspace-types";

const OWNER = "kdp-owner";
const DETAIL_LIMIT = MCP_LIMITS.detail;
const OVERVIEW_LIMIT = MCP_LIMITS.overview;
const REPORT_CURSOR_STRIDE = 1_000_000;
const ARGUMENT_KEYS = new Set(["revision", "offset", "limit"]);
const RULES_DEFAULT_LIMIT = 4000;
const RULES_MAX_LIMIT = 4000;
const encoder = new TextEncoder();

class InvalidArguments extends Error {}

type Truncation = {
  path: string;
  original_characters: number;
  returned_characters: number;
  reason: "field_limit" | "page_limit";
  next_offset?: number | null;
  full_body_available?: boolean;
};

type Page = {
  unit: "records" | "characters";
  offset: number;
  limit: number;
  total: number;
  returned: number;
  next_offset: number | null;
  budget_limited: boolean;
};

type ParsedArgs = {
  revision?: number;
  offset: number;
  limit: number;
};

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidArguments(name);
  }
  return value;
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  return integer(value, name, min, min, max);
}

function parseArgs(raw: unknown, operation: GuOperation): ParsedArgs {
  if (raw === undefined) raw = {};
  if (!isObject(raw)) throw new InvalidArguments("args");
  for (const key of Object.keys(raw)) {
    if (!ARGUMENT_KEYS.has(key)) throw new InvalidArguments(key);
  }
  const defaultLimit = operation === "reports" ? 10 : operation === "rules" ? RULES_DEFAULT_LIMIT : 25;
  const maximumLimit = operation === "rules" ? RULES_MAX_LIMIT : 100;
  return {
    revision: optionalInteger(raw.revision, "revision", 1, Number.MAX_SAFE_INTEGER),
    offset: integer(raw.offset, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
    limit: integer(raw.limit, "limit", defaultLimit, 1, maximumLimit),
  };
}

function page(
  unit: "records" | "characters",
  offset: number,
  limit: number,
  total: number,
  returned: number,
  nextOffset: number | null,
  budgetLimited = false,
): Page {
  return { unit, offset, limit, total, returned, next_offset: nextOffset, budget_limited: budgetLimited };
}

function commonData(operation: GuOperation, workspace: WorkspaceView): Record<string, unknown> {
  const asOf = workspace.data.account.confirmed_on ?? workspace.valuation.oldest_date;
  return {
    operation,
    empty: !workspace.active,
    revision: workspace.revision,
    updated_at: workspace.updated_at,
    as_of: asOf,
  };
}

function textClip(value: unknown, maximum: number, path: string, output: Truncation[]): string {
  const text = typeof value === "string" ? value : "";
  const points = Array.from(text);
  if (points.length <= maximum) return text;
  output.push({
    path,
    original_characters: points.length,
    returned_characters: maximum,
    reason: "field_limit",
  });
  return points.slice(0, maximum).join("");
}

function decimalUnits(): Record<string, string> {
  return {
    value_usd: "USD",
    currency: "row currency (ISO 4217); null means unknown",
    quantity: "decimal text in instrument units; null means unknown",
    amount: "decimal text in the row's currency; null means unknown",
    cost_total: "decimal text in the row's currency; null means unknown",
  };
}

function accountOverview(workspace: WorkspaceView, truncation: Truncation[]): Record<string, unknown> {
  const account = workspace.data.account;
  const valuation = workspace.valuation;
  return {
    name: account.name,
    confirmed_on: account.confirmed_on,
    notes: textClip(account.notes, 500, "account.notes", truncation),
    record_counts: {
      holdings: account.holdings.length,
      cash: account.cash.length,
      trades: account.trades.length,
      reports: workspace.data.reports.length,
    },
    valuation: {
      total_usd: valuation.total_usd,
      known_usd: valuation.known_usd,
      missing: valuation.missing,
      entries: valuation.entries,
      oldest_date: valuation.oldest_date,
      warnings: valuation.warnings.map((warning, index) =>
        textClip(warning, 300, `account.valuation.warnings[${index}]`, truncation)),
    },
  };
}

function holdingData(holding: Holding, index: number, truncation: Truncation[]): Record<string, unknown> {
  return {
    id: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    account: holding.account,
    currency: holding.currency,
    quantity: holding.quantity,
    cost_total: holding.cost_total,
    value_usd: holding.value_usd,
    valued_on: holding.valued_on,
    source: textClip(holding.source, 300, `holdings[${index}].source`, truncation),
  };
}

function cashData(cash: CashBalance, index: number, truncation: Truncation[]): Record<string, unknown> {
  return {
    id: cash.id,
    name: cash.name,
    account: cash.account,
    currency: cash.currency,
    amount: cash.amount,
    value_usd: cash.value_usd,
    confirmed_on: cash.confirmed_on,
    source: textClip(cash.source, 300, `cash[${index}].source`, truncation),
  };
}

function tradeData(trade: Trade, index: number, truncation: Truncation[]): Record<string, unknown> {
  return {
    id: trade.id,
    date: trade.date,
    account: trade.account,
    kind: trade.kind,
    symbol: trade.symbol,
    currency: trade.currency,
    quantity: trade.quantity,
    amount: trade.amount,
    note: textClip(trade.note, 300, `trades[${index}].note`, truncation),
  };
}

function reportMetadata(report: ResearchReport, index: number, truncation: Truncation[]): Record<string, unknown> {
  return {
    id: report.id,
    title: report.title,
    date: report.date,
    trading_date: report.trading_date,
    date_source: report.date_source,
    kind: report.kind,
    summary: textClip(report.summary, 600, `reports[${index}].summary`, truncation),
    source: textClip(report.source, 300, `reports[${index}].source`, truncation),
    based_on_revision: report.based_on_revision,
  };
}

function listPage<T>(
  base: Record<string, unknown>,
  baseTruncation: Truncation[],
  records: readonly T[],
  key: string,
  offset: number,
  limit: number,
  map: (record: T, index: number, output: Truncation[]) => unknown,
): Record<string, unknown> {
  const selected: unknown[] = [];
  const truncation = [...baseTruncation];
  let index = offset;
  let budgetLimited = false;

  while (index < records.length && selected.length < limit) {
    const itemTruncation: Truncation[] = [];
    const item = map(records[index], index, itemTruncation);
    const candidateItems = [...selected, item];
    const candidateTruncation = [...truncation, ...itemTruncation];
    const next = index + 1 < records.length ? index + 1 : null;
    const candidate = {
      ...base,
      [key]: candidateItems,
      page: page("records", offset, limit, records.length, candidateItems.length, next),
      truncation: {
        truncated: candidateTruncation.length > 0,
        fields: candidateTruncation,
      },
    };
    if (byteLength({ ok: true, data: candidate }) > DETAIL_LIMIT) {
      budgetLimited = true;
      break;
    }
    selected.push(item);
    truncation.push(...itemTruncation);
    index++;
  }

  const next = index < records.length ? index : null;
  return {
    ...base,
    [key]: selected,
    page: page("records", offset, limit, records.length, selected.length, next, budgetLimited),
    truncation: {
      truncated: truncation.length > 0,
      fields: truncation,
    },
  };
}

function bodyPage(
  base: Record<string, unknown>,
  baseTruncation: Truncation[],
  body: string,
  fieldPath: string,
  offset: number,
  limit: number,
  setBody: (data: Record<string, unknown>, chunk: string) => void,
): Record<string, unknown> {
  const points = Array.from(body);
  const start = Math.min(offset, points.length);
  let returned = Math.min(limit, points.length - start);
  let budgetLimited = false;

  const build = (count: number) => {
    const chunk = points.slice(start, start + count).join("");
    const next = start + count < points.length ? start + count : null;
    const truncation = [...baseTruncation];
    if (next !== null) {
      truncation.push({
        path: fieldPath,
        original_characters: points.length,
        returned_characters: count,
        reason: "page_limit",
        next_offset: next,
        full_body_available: true,
      });
    }
    const data: Record<string, unknown> = {
      ...base,
      page: page("characters", offset, limit, points.length, count, next, budgetLimited),
      truncation: {
        truncated: truncation.length > 0,
        fields: truncation,
      },
    };
    setBody(data, chunk);
    return data;
  };

  let data = build(returned);
  while (byteLength({ ok: true, data }) > DETAIL_LIMIT && returned > 0) {
    budgetLimited = true;
    returned = Math.max(0, returned - 64);
    data = build(returned);
  }
  return data;
}

function reportStreamData(workspace: WorkspaceView, parsed: ParsedArgs): Record<string, unknown> {
  const reports = workspace.data.reports;
  const base = commonData("reports", workspace);
  const items: Record<string, unknown>[] = [];
  const truncation: Truncation[] = [];
  let index = Math.floor(parsed.offset / REPORT_CURSOR_STRIDE);
  let bodyOffset = parsed.offset % REPORT_CURSOR_STRIDE;
  let nextOffset: number | null = null;
  let budgetLimited = false;

  while (index < reports.length && items.length < parsed.limit) {
    const report = reports[index];
    const body = typeof report.body === "string" ? report.body : "";
    const points = Array.from(body);
    const start = Math.min(bodyOffset, points.length);
    let count = Math.min(points.length - start, 6000);
    let item: Record<string, unknown> | null = null;
    let itemTruncation: Truncation[] = [];

    while (true) {
      const localTruncation: Truncation[] = [];
      const chunk = points.slice(start, start + count).join("");
      const complete = start + count >= points.length;
      const cursor = complete
        ? index + 1 < reports.length ? (index + 1) * REPORT_CURSOR_STRIDE : null
        : index * REPORT_CURSOR_STRIDE + start + count;
      const candidateItem = {
        ...reportMetadata(report, index, localTruncation),
        body: chunk,
        body_offset: start,
        body_characters: points.length,
        body_complete: complete,
        next_offset: cursor,
      };
      if (!complete) {
        localTruncation.push({
          path: `reports[${index}].body`,
          original_characters: points.length,
          returned_characters: count,
          reason: "page_limit",
          next_offset: cursor,
          full_body_available: true,
        });
      }
      const candidateItems = [...items, candidateItem];
      const candidateTruncation = [...truncation, ...localTruncation];
      const candidate = {
        ...base,
        reports: candidateItems,
        page: page("records", parsed.offset, parsed.limit, reports.length, candidateItems.length, cursor, budgetLimited),
        truncation: { truncated: candidateTruncation.length > 0, fields: candidateTruncation },
      };
      if (byteLength({ ok: true, data: candidate }) <= DETAIL_LIMIT) {
        item = candidateItem;
        itemTruncation = localTruncation;
        nextOffset = cursor;
        break;
      }
      if (count === 0) break;
      budgetLimited = true;
      count = Math.max(0, count - 128);
    }

    if (!item) break;
    items.push(item);
    truncation.push(...itemTruncation);
    const complete = item.body_complete === true;
    if (!complete) break;
    index++;
    bodyOffset = 0;
  }

  if (index >= reports.length) nextOffset = null;
  return {
    ...base,
    reports: items,
    page: page("records", parsed.offset, parsed.limit, reports.length, items.length, nextOffset, budgetLimited),
    truncation: { truncated: truncation.length > 0, fields: truncation },
  };
}

function rulesData(workspace: WorkspaceView, parsed: ParsedArgs): Record<string, unknown> {
  const truncation: Truncation[] = [];
  const rule = workspace.data.rules;
  const base = {
    ...commonData("rules", workspace),
    rule: {
      title: textClip(rule.title, 150, "rule.title", truncation),
    },
  };
  return bodyPage(base, truncation, typeof rule.body === "string" ? rule.body : "",
    "rule.body", parsed.offset, parsed.limit, (data, chunk) => {
      const current = data.rule;
      data.rule = { ...(isObject(current) ? current : {}), body: chunk };
    });
}

function emptyOperationData(operation: GuOperation, workspace: WorkspaceView, parsed: ParsedArgs): Record<string, unknown> {
  const common = commonData(operation, workspace);
  const unit = operation === "rules" ? "characters" : "records";
  const emptyPage = page(unit, parsed.offset, parsed.limit, 0, 0, null);
  const emptyTruncation = { truncated: false, fields: [] };
  const note = "尚未启用线上投资工作区；旧看板快照不会通过 MCP 提供。";
  if (operation === "portfolio") {
    return { ...common, note, account: null, holdings: [], units: decimalUnits(), page: emptyPage, truncation: emptyTruncation };
  }
  if (operation === "cash") {
    return { ...common, note, cash: [], units: decimalUnits(), page: emptyPage, truncation: emptyTruncation };
  }
  if (operation === "trades") {
    return { ...common, note, trades: [], units: decimalUnits(), page: emptyPage, truncation: emptyTruncation };
  }
  if (operation === "rules") {
    return { ...common, note, rule: null, page: emptyPage, truncation: emptyTruncation };
  }
  return {
    ...common,
    note,
    reports: [],
    page: emptyPage,
    truncation: emptyTruncation,
  };
}

function compactSummary(summary: SourceSummary): SourceSummary {
  const result: SourceSummary = {
    ...summary,
    metrics: summary.metrics.map(metric => ({ ...metric })),
    facts: [...summary.facts],
    notes: [...summary.notes],
    attention: summary.attention.map(item => ({ ...item })),
  };
  const shrink = () => {
    if (result.attention.length) result.attention.pop();
    else if (result.metrics.length) result.metrics.pop();
    else if (result.facts.length) result.facts.pop();
    else if (result.notes.length) result.notes.pop();
    else return false;
    return true;
  };
  while (byteLength(result) > OVERVIEW_LIMIT && shrink()) {
    // Keep the source/status/time fields; detail can be fetched from GU.
  }
  if (byteLength(result) > OVERVIEW_LIMIT) {
    result.notes = ["摘要超过概览大小限制。"];
    result.facts = [];
    result.metrics = [];
    result.attention = [];
  }
  return result;
}

function publicSummary(summary: DeskSummary): SourceSummary {
  const { privateMetric: _privateMetric, ...publicFields } = summary;
  return compactSummary(publicFields);
}

/** Named RPC entrypoint. It has no write path and never reads dashboard_batches. */
export class GuMcp extends WorkerEntrypoint<Env> implements GuService {
  async execute(request: DomainRequest<GuOperation>): Promise<DomainReply> {
    if (request?.subject !== OWNER) return { ok: false, error: "not_owner", status: 403 };
    if (!GU_OPERATIONS.includes(request.operation)) {
      return { ok: false, error: "invalid_arguments", status: 400 };
    }
    try {
      const parsed = parseArgs(request.args, request.operation);
      const workspace = await readWorkspace(this.env);
      if (parsed.offset > 0 && parsed.revision === undefined) {
        return { ok: false, error: "revision_required", status: 409 };
      }
      if (parsed.revision !== undefined && parsed.revision !== workspace.revision) {
        return { ok: false, error: "revision_changed", status: 409 };
      }
      if (!workspace.active) {
        return { ok: true, data: emptyOperationData(request.operation, workspace, parsed) };
      }

      if (request.operation === "portfolio") {
        const truncation: Truncation[] = [];
        const base = {
          ...commonData("portfolio", workspace),
          account: accountOverview(workspace, truncation),
          units: decimalUnits(),
        };
        return {
          ok: true,
          data: listPage(base, truncation, workspace.data.account.holdings, "holdings", parsed.offset, parsed.limit, holdingData),
        };
      }
      if (request.operation === "cash") {
        const base = { ...commonData("cash", workspace), units: decimalUnits() };
        return {
          ok: true,
          data: listPage(base, [], workspace.data.account.cash, "cash", parsed.offset, parsed.limit, cashData),
        };
      }
      if (request.operation === "trades") {
        const base = { ...commonData("trades", workspace), units: decimalUnits() };
        return {
          ok: true,
          data: listPage(base, [], workspace.data.account.trades, "trades", parsed.offset, parsed.limit, tradeData),
        };
      }
      if (request.operation === "rules") {
        return { ok: true, data: rulesData(workspace, parsed) };
      }
      return { ok: true, data: reportStreamData(workspace, parsed) };
    } catch (failure) {
      if (failure instanceof InvalidArguments) return { ok: false, error: "invalid_arguments", status: 400 };
      return { ok: false, error: "internal_error", status: 500 };
    }
  }

  async summary(subject: string): Promise<SourceSummary> {
    if (subject !== OWNER) {
      const { privateMetric: _privateMetric, ...empty } = emptySummary("gu", "未授权");
      return { ...empty, source: "gu", status: "unavailable" };
    }
    const workspace = await readWorkspace(this.env);
    if (!workspace.active) {
      return publicSummary(emptySummary("gu", "尚未启用线上投资工作区；旧看板快照不会通过 MCP 提供。"));
    }
    return publicSummary(onlineWorkspaceSummary(workspace));
  }
}
