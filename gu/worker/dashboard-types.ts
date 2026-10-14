export type Row = Record<string, unknown>;
export interface Dashboard {
  account: Row[];
  positions: Row[];
  risk: Row[];
  market: Row[];
  // Present from schema v2; older batches have no weight history.
  history?: Row[];
  reports: Row[];
}
