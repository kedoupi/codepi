export type AppPath = "/" | "/insights" | "/compare" | "/settings";

export function normalizePath(pathname = location.pathname): AppPath {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/insights" || p === "/compare" || p === "/settings") return p;
  return "/";
}

export const router = $state({ path: "/" as AppPath });

export function goto(next: string, replace = false): void {
  const url = next.startsWith("/") ? next : `/${next}`;
  const normalized = normalizePath(url.split("?")[0] ?? url);
  const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  if (replace) history.replaceState({}, "", normalized + qs);
  else history.pushState({}, "", normalized + qs);
  router.path = normalized;
}

export function initRouter(): () => void {
  router.path = normalizePath();
  const onPop = () => {
    router.path = normalizePath();
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}
