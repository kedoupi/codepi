import type { BoardPost, SlotRow } from "./api";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function statusLabel(status: BoardPost["status"]): string {
  return status === "draft" ? "草稿" : status;
}

/** Soft filled chip class aligned with gzh-preview `.st` / `.st-*`. */
export function statusChipClass(status: BoardPost["status"]): string {
  const key = status === "draft" ? "草稿" : status;
  return `stamp st s-${key} st-${key}`;
}

export function slotHint(slot: SlotRow["slot"]): string {
  if (slot === "早") return "晨间";
  if (slot === "中") return "午间";
  return "晚间";
}

export function formatZhDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const week = ["日", "一", "二", "三", "四", "五", "六"][dt.getUTCDay()];
  return `${y}年${m}月${d}日 周${week}`;
}

export function previewSrc(post: BoardPost): string | null {
  if (!post.preview_path) return null;
  if (post.preview_path.startsWith("/p/")) return null;
  return post.preview_path;
}

/**
 * Real cover thumb URL from preview_path (…/cover.png), matching gzh-preview.
 * Returns null when there is no usable preview dir (caller shows empty thumb).
 */
export function coverSrc(previewPath: string | null | undefined): string | null {
  if (!previewPath?.trim()) return null;
  const raw = previewPath.trim();
  if (raw.startsWith("/p/")) return null;

  const appendCover = (origin: string, pathname: string): string | null => {
    let p = pathname
      .replace(/\/index\.html$/i, "")
      .replace(/\/+$/, "");
    if (!p || p === "/") return null;
    if (p.startsWith("/p/") || p === "/p") return null;
    return `${origin}${p}/cover.png`;
  };

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return appendCover(u.origin, u.pathname);
    } catch {
      return null;
    }
  }

  const pathOnly = raw.split(/[?#]/)[0] || "";
  return appendCover("", pathOnly);
}

/** Square thumb class; cover URL comes from coverSrc (component renders the <img>). */
export function thumbClass(previewPath: string | null | undefined, extraClass = ""): string {
  const src = coverSrc(previewPath);
  return `thumb${extraClass ? ` ${extraClass}` : ""}${src ? "" : " is-empty"}`;
}

export function bindBrokenCovers(root: ParentNode = document): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-cover]")) {
    const fail = () => {
      const box = img.closest(".thumb");
      box?.classList.add("is-empty");
      img.remove();
    };
    if (img.complete && img.naturalWidth === 0) {
      fail();
      continue;
    }
    img.addEventListener("error", fail, { once: true });
  }
}
