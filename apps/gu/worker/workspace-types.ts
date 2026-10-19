export interface Holding {
  id: string;
  symbol: string;
  name: string;
  account: string;
  currency: string | null;
  quantity: string | null;
  cost_total: string | null;
  value_usd: string | null;
  valued_on: string | null;
  source: string;
}

export interface CashBalance {
  id: string;
  name: string;
  account: string;
  currency: string | null;
  amount: string | null;
  value_usd: string | null;
  confirmed_on: string | null;
  source: string;
}

export interface Trade {
  id: string;
  date: string;
  account: string;
  kind: "buy" | "sell" | "deposit" | "withdrawal" | "dividend" | "fee";
  symbol: string;
  currency: string;
  quantity: string | null;
  amount: string;
  note: string;
}

export interface ResearchReport {
  id: string;
  title: string;
  date: string;
  trading_date: string | null;
  date_source: string;
  kind: string;
  summary: string;
  body: string;
  source: string;
  based_on_revision: number | null;
}

export interface WorkspaceData {
  account: {
    name: string;
    confirmed_on: string | null;
    notes: string;
    holdings: Holding[];
    cash: CashBalance[];
    trades: Trade[];
  };
  rules: { title: string; body: string };
  reports: ResearchReport[];
}

export interface Valuation {
  total_usd: string | null;
  known_usd: string;
  missing: number;
  entries: number;
  oldest_date: string | null;
  warnings: string[];
}

export interface WorkspaceView {
  active: boolean;
  revision: number;
  updated_at: string | null;
  data: WorkspaceData;
  valuation: Valuation;
  materials_enabled: boolean;
}

export interface Material {
  id: string;
  name: string;
  content_type: string;
  size: number;
  sha256: string;
  created_at: string;
}

export function emptyWorkspace(): WorkspaceData {
  return {
    account: { name: "我的投资账户", confirmed_on: null, notes: "", holdings: [], cash: [], trades: [] },
    rules: { title: "投资规则", body: "" },
    reports: [],
  };
}
