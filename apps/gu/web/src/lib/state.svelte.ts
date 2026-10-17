import type { CalendarView } from "../calendar";
import type { Snapshot } from "./format";
import { validHash } from "./router.svelte";

export type AuthState = "unknown" | "authenticated" | "anonymous";
export type DataState = "loading" | "ready" | "empty" | "failed";

/**
 * 会话与数据批次的全局状态。等价于旧 main.ts 顶层的模块变量：
 * 401 清空快照、loadVersion 作并发哨兵、pendingPositionFocus 等 DOM 重建后
 * 再消费的跳转标记，语义保持不变。
 */
export const session = $state({
  auth: "unknown" as AuthState,
  dataState: "loading" as DataState,
  snapshot: null as Snapshot | null,
  loading: false,
  notice: "",
  ssoMode: undefined as boolean | undefined,
  loadVersion: 0,
  /** 退出/401 后要恢复的 hash，登录成功后由 App 消费。 */
  returnHash: "",
  calendar: null as CalendarView | null,
  calendarFailed: false,
  pendingPositionFocus: null as string | null,
  /** 401 / 退出：丢弃私人数据并让 App 切回登录页。 */
  clear() {
    this.returnHash = validHash(location.hash);
    this.snapshot = null;
    this.calendar = null;
    this.auth = "anonymous";
    this.loading = false;
    this.notice = "";
    this.loadVersion++;
  },
});

export const filters = $state({
  reportQuery: "",
  reportKind: "",
  selectedHistory: "",
});

export function resetFilters() {
  filters.reportQuery = "";
  filters.reportKind = "";
  filters.selectedHistory = "";
}
