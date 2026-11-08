type ReviewItem = { slug: string; title: string; summary: string; revision: number; updated_at: string; published_at?: string | null; cover_media_id?: string | null; category?: string | null; sources?: string | null };
const page = document.getElementById("blog-review-page") as HTMLElement;
const previewSlug = page.dataset.slug ?? null;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") => {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
};
const categoryNames: Record<string, string> = { "digital-space": "数字空间", health: "健康记录", investing: "投资观察", content: "内容工作", tech: "技术实践", life: "生活随笔" };
const sourceList = (value?: string | null): Array<{ title: string; url: string }> => {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.title === "string" && typeof item.url === "string") : []; } catch { return []; }
};
const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚无记录";
let queueItems: ReviewItem[] = [], publishedItems: ReviewItem[] = [], selectedSlug: string | null = previewSlug, active = false, generation = 0, previewCleanup: (() => void) | null = null;
const controllers = new Set<AbortController>();
class SessionExpired extends Error {}
function reviewMessage(message: string, failed = false) { const status = el("blog-review-status"); status.dataset.tone = failed ? "error" : ""; status.textContent = message; }
function clearPreview() { previewCleanup?.(); previewCleanup = null; }
function clearPrivate() {
  generation++;
  active = false;
  clearPreview();
  for (const controller of controllers) controller.abort();
  controllers.clear();
  el("blog-review-private").hidden = true;
  el("blog-review-login").hidden = false;
  queueItems = [];
  publishedItems = [];
  el("blog-drafts-list").replaceChildren();
  el("blog-published-list").replaceChildren();
  el("blog-review-detail").replaceChildren();
}
function showLogin(message: string) { clearPrivate(); el("blog-review-login").hidden = false; el("blog-review-login-note").textContent = message; }
async function api(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (response.status === 401) { showLogin("登录已到期或已退出，请重新登录后继续。"); throw new SessionExpired(); }
    if (!response.ok) throw Error(response.status === 409 ? "草稿已有新修订，请返回列表重新读取。" : "连接暂不可用，请稍后重试。");
    return await response.json();
  } finally { clearTimeout(timer); controllers.delete(controller); }
}
function reviewCover(item: ReviewItem) {
  const cover = node("span", "", "desk-review-thumb");
  if (item.cover_media_id) {
    const image = node("img");
    image.src = `/blog/media/${encodeURIComponent(item.cover_media_id)}`;
    image.alt = "";
    image.loading = "lazy";
    cover.append(image);
  } else {
    cover.classList.add("blog-cover-fallback");
    cover.setAttribute("role", "img");
    cover.setAttribute("aria-label", "默认占位图");
    cover.innerHTML = '<svg viewBox="0 0 640 272" aria-hidden="true" focusable="false"><path d="M24 32Q240 80 320 136T616 240M40 240Q230 180 320 136T600 32M120 8Q270 90 320 136T520 264M120 264Q270 180 320 136T520 8M8 136Q220 136 320 136T632 136"/><circle cx="320" cy="136" r="54"/><circle class="blog-cover-core" cx="320" cy="136" r="8"/></svg>';
  }
  return cover;
}
function renderListRow(item: ReviewItem, published: boolean, live = false) {
  const link = node("a", "", "desk-review-list-row");
  link.href = `/desk/blog/${encodeURIComponent(item.slug)}/`;
  link.dataset.slug = item.slug;
  link.append(reviewCover(item));
  const content = node("span", "", "desk-review-list-content");
  content.append(node("strong", item.title, "desk-queue-title"));
  content.append(node("span", `${published ? "已上架" : live ? "已上架 · 有新版待审" : "待审"} · ${item.category ? categoryNames[item.category] ?? item.category : "未分类"} · ${time(item.updated_at)}`, "desk-queue-meta"));
  link.append(content);
  return link;
}
function renderLists() {
  const live = new Map(publishedItems.map(item => [item.slug, item]));
  el("blog-drafts-list").replaceChildren(...(queueItems.length ? queueItems.map(item => renderListRow(item, false, live.has(item.slug))) : [node("p", "暂无待审稿件。", "desk-review-empty")]));
  el("blog-published-list").replaceChildren(...(publishedItems.length ? publishedItems.map(item => renderListRow(item, true)) : [node("p", "暂无已上架文章。", "desk-review-empty")]));
}
function previewFrame(item: ReviewItem) {
  const frame = document.createElement("iframe");
  frame.className = "desk-preview-frame";
  frame.title = `预览：${item.title}`;
  frame.loading = "eager";
  frame.src = `/blog/preview/${encodeURIComponent(item.slug)}/?embed=1`;
  const resize = () => {
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (documentElement) frame.style.height = `${Math.max(documentElement.scrollHeight, body?.scrollHeight ?? 0, 360)}px`;
  };
  frame.addEventListener("load", () => {
    resize();
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (!documentElement) return;
    const observer = new ResizeObserver(resize);
    observer.observe(documentElement);
    if (body) observer.observe(body);
    for (const image of frame.contentDocument?.images ?? []) image.addEventListener("load", resize);
    previewCleanup = () => {
      observer.disconnect();
      for (const image of frame.contentDocument?.images ?? []) image.removeEventListener("load", resize);
    };
  });
  return frame;
}
function setView(view: "list" | "detail") {
  page.dataset.view = view;
  el("blog-review-workspace").dataset.view = view;
  el("blog-review-workspace").closest<HTMLElement>(".desk-review")?.setAttribute("data-view", view);
}
function renderSources(container: HTMLElement, value?: string | null) {
  const sources = sourceList(value);
  if (!sources.length) return;
  const section = node("section", "", "desk-review-sources");
  section.append(node("h4", "资料来源"));
  const list = node("ul");
  for (const source of sources) { const item = node("li"); const link = node("a", source.title, "kdp-link"); link.href = source.url; link.rel = "noopener noreferrer"; item.append(link); list.append(item); }
  section.append(list);
  container.append(section);
}
function renderDetail(item: ReviewItem | null, published = false) {
  const detail = el("blog-review-detail");
  clearPreview();
  detail.replaceChildren();
  if (!item) return;
  const back = node("a", "← 返回列表", "desk-text-button desk-detail-back");
  back.href = "/desk/blog/";
  detail.append(back);
  const live = publishedItems.some(entry => entry.slug === item.slug);
  const body = node("div", "", "desk-detail-body");
  body.dataset.slug = item.slug;
  body.dataset.revision = String(item.revision);
  const toolbar = node("div", "", "desk-detail-toolbar");
  const heading = node("div", "", "desk-detail-heading");
  heading.append(node("p", published ? "已上架" : live ? "已上架 · 有新版待审" : "待审", "desk-review-meta"), node("h1", item.title));
  toolbar.append(heading);
  const button = node("button", published ? "下架" : "审核通过，上架", published ? "kdp-button kdp-button--secondary" : "kdp-button");
  button.type = "button";
  button.dataset.reviewAction = published ? "unpublish" : "publish";
  toolbar.append(button);
  body.append(toolbar);
  if (!published && live) body.append(node("aside", "线上仍是旧版，通过后替换。", "desk-review-notice"));
  body.append(previewFrame(item));
  detail.append(body);
}
async function loadReview(message = "") {
  if (!active) return;
  const current = generation;
  try {
    const [drafts, published] = await Promise.all([api("/api/blog/drafts") as Promise<{ drafts: ReviewItem[] }>, api("/api/blog/posts") as Promise<{ posts: ReviewItem[]; total: number }>]);
    if (current !== generation || !active) return;
    queueItems = drafts.drafts;
    publishedItems = published.posts;
    if (previewSlug) {
      const draft = queueItems.find(item => item.slug === previewSlug);
      const live = publishedItems.find(item => item.slug === previewSlug);
      if (!draft && !live) { reviewMessage("稿件不存在或已被移除。", true); return; }
      setView("detail");
      renderDetail(draft ?? live ?? null, !draft && !!live);
      reviewMessage(message || `${!draft && live ? "已上架" : "待审"} · 修订 ${(draft ?? live)!.revision}`);
    } else {
      setView("list");
      renderLists();
      reviewMessage(message || `${queueItems.length} 篇待审，${published.total ?? publishedItems.length} 篇已上架。`);
    }
  } catch (error) { if (current === generation && !(error instanceof SessionExpired)) reviewMessage("博客审核暂时无法读取，请重试。", true); }
}
async function reviewAction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-review-action]");
  const row = button?.closest<HTMLElement>("[data-slug]");
  if (!active || !button || !row || button.disabled) return;
  const action = button.dataset.reviewAction;
  if (!action) return;
  const revision = Number(row.dataset.revision);
  if (!window.confirm(action === "publish" ? `通过上架《${row.querySelector("h1")?.textContent ?? "这篇文章"}》？` : `下架《${row.querySelector("h1")?.textContent ?? "这篇文章"}》？`)) return;
  button.disabled = true;
  try {
    const slug = encodeURIComponent(row.dataset.slug!);
    await api(action === "publish" ? `/api/blog/drafts/${slug}/publish` : `/api/blog/posts/${slug}/unpublish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    window.location.href = `/desk/blog/?result=${action === "publish" ? "published" : "unpublished"}`;
  } catch (error) { if (!(error instanceof SessionExpired)) { button.disabled = false; reviewMessage("操作暂时无法完成，请重试。", true); } }
}
function showLoginPage() { clearPrivate(); el("blog-review-login").hidden = false; }
async function initialize() {
  clearPrivate();
  el("blog-review-login").hidden = true;
  try { await api("/api/desk/me"); active = true; el("blog-review-private").hidden = false; await loadReview(new URLSearchParams(location.search).get("result") === "published" ? "文章已上架。" : new URLSearchParams(location.search).get("result") === "unpublished" ? "文章已下架。" : ""); }
  catch (error) { if (!(error instanceof SessionExpired)) showLoginPage(); }
}
el("blog-review-detail").addEventListener("click", reviewAction);
el("blog-review-status").setAttribute("aria-live", "polite");
const retry = node("button", "重新读取", "desk-text-button");
retry.type = "button";
retry.addEventListener("click", () => { void loadReview(); });
el("blog-review-status").after(retry);
window.addEventListener("pagehide", clearPrivate);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearPrivate(); else void initialize(); });
void initialize();
