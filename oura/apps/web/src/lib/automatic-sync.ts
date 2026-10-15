import { api, RequestError } from "./api.ts";
import type { AutomaticSyncStatus } from "./health.ts";

const path = "/api/me/health-records/automatic";

export function createAutomaticSync(options: {
  onStatus: (value: AutomaticSyncStatus, previous: AutomaticSyncStatus | null) => void;
  onError: (error: unknown) => void;
}) {
  let value: AutomaticSyncStatus | null = null;
  let disposed = false;
  let revision = 0;
  let request: AbortController | null = null;
  let starting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => { void refresh(); }, value?.status === "running" ? 5_000 : 30_000);
  }

  async function read(method: "GET" | "POST") {
    clearTimeout(timer);
    const currentRevision = ++revision;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    let conflict = false;
    try {
      const result = await api<AutomaticSyncStatus>(path, { method, signal: controller.signal });
      if (disposed || currentRevision !== revision) return;
      const previous = value;
      value = result;
      options.onStatus(result, previous);
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      options.onError(error);
      conflict = method === "POST" && error instanceof RequestError && error.code === "sync_in_progress";
    } finally {
      if (!disposed && currentRevision === revision) {
        request = null;
        // A legacy sync may own the lease. Observe it; never retry POST from a timer.
        if (conflict) await read("GET");
        else schedule();
      }
    }
  }

  async function refresh() {
    if (disposed || request || starting) return;
    await read("GET");
  }

  async function start() {
    if (disposed || starting) return;
    starting = true;
    try { await read("POST"); }
    finally { starting = false; }
  }

  return {
    start,
    refresh,
    dispose() {
      disposed = true;
      revision++;
      clearTimeout(timer);
      request?.abort();
      request = null;
    },
  };
}
