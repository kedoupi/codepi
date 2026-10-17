import type { Account } from "../api";
import { validRoute, type Route } from "./router.svelte";

/**
 * 全局视图状态。等价于旧 main.ts 顶层的模块变量：
 * privateView / 会话检查竞态在组件生命周期里由 onDestroy 与过期版本号表达，
 * 语义保持不变。
 */
export const appState = $state({
  route: "desk" as Route,
  account: null as Account | null,
  booted: false,
});

export function syncRoute() {
  appState.route = validRoute(location.pathname);
}

/** URL 导航：和旧实现一样走 location.assign，触发整页跳转（worker 回退到同一 SPA）。 */
export function navigateTo(href: string) {
  location.assign(href);
}
