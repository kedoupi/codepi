type ToastKind = "ok" | "err" | "info";

/** 轻提示：与旧实现一致，2.4s 淡出、2.8s 移除。 */
export function showToast(text: string, kind: ToastKind = "info") {
  let host = document.querySelector<HTMLElement>(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", "status");
  el.textContent = text;
  host.append(el);
  window.setTimeout(() => el.classList.add("is-out"), 2400);
  window.setTimeout(() => el.remove(), 2800);
}

/** 跨整页跳转的提示：存入 sessionStorage，下一次挂载后由 App 取出展示。 */
export function flashToast(text: string, kind: ToastKind = "ok") {
  try {
    sessionStorage.setItem("gzh-flash", JSON.stringify({ text, kind }));
  } catch {
    /* private mode */
  }
}

export function drainFlash() {
  try {
    const raw = sessionStorage.getItem("gzh-flash");
    if (!raw) return;
    sessionStorage.removeItem("gzh-flash");
    const { text, kind } = JSON.parse(raw) as { text: string; kind: ToastKind };
    showToast(text, kind);
  } catch {
    /* ignore */
  }
}

export function errText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
