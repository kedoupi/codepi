export type Row = Record<string, unknown>;
export interface Dashboard {
  account: Row[];
  positions: Row[];
  risk: Row[];
  market: Row[];
  reports: Row[];
}
