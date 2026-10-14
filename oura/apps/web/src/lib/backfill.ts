export type SyncWindow = { collection: string; from: string; to: string };
export type SyncFailure = SyncWindow & { code: string; requestId?: string };
export type BackfillResult = { failed: SyncFailure[]; remaining: SyncWindow[]; completed: number; total: number; splits: number };
const DAY = 86400000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
export const windowDays = (window: SyncWindow) => (Date.parse(window.to) - Date.parse(window.from)) / DAY + 1;
export function planBackfill(collections: { name: string; mode: string }[], days: number, today = date(Date.now())) {
  return collections.flatMap(row => {
    const snapshot = row.mode === "profile" || row.mode === "snapshot";
    const step = row.mode === "time" ? 1 : 30;
    const windows: SyncWindow[] = [];
    for (let back = 0; back < (snapshot ? 1 : days); back += step) {
      windows.push({
        collection: row.name,
        from: date(Date.parse(today) - (snapshot ? 0 : Math.min(back + step - 1, days - 1)) * DAY),
        to: date(Date.parse(today) - back * DAY),
      });
    }
    return windows;
  });
}

export async function runBackfill(windows: SyncWindow[], options: {
  request: (window: SyncWindow) => Promise<unknown>;
  shouldStop: () => boolean;
  progress: (state: BackfillResult & { current: SyncWindow }) => void;
}) {
  const queue = [...windows];
  const result: BackfillResult = { failed: [], remaining: [], completed: 0, total: windows.reduce((sum, w) => sum + windowDays(w), 0), splits: 0 };
  while (queue.length && !options.shouldStop()) {
    const current = queue.shift()!;
    options.progress({ ...result, current });
    try {
      await options.request(current);
      result.completed += windowDays(current);
    } catch (error) {
      const detail = error as { code?: string; requestId?: string };
      const code = detail?.code || "service_unavailable";
      const days = windowDays(current);
      if (code === "sync_window_too_large" && days > 1) {
        const midpoint = Date.parse(current.from) + Math.floor(days / 2) * DAY;
        // Newest half first, with inclusive boundaries and no overlap or gaps.
        queue.unshift(
          { ...current, from: date(midpoint) },
          { ...current, to: date(midpoint - DAY) },
        );
        result.splits++;
        continue;
      }
      result.failed.push({ ...current, code, requestId: detail?.requestId });
      if (["rate_limited", "reconnect_required", "unauthorized", "sync_in_progress", "network_error"].includes(code)) break;
      if (code !== "sync_window_too_large") {
        // Preserve skipped work for an explicit retry without hammering a denied collection.
        result.remaining.push(...queue.filter(w => w.collection === current.collection));
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].collection === current.collection) queue.splice(i, 1);
      }
    }
    options.progress({ ...result, current });
  }
  result.remaining.push(...queue);
  return result;
}
