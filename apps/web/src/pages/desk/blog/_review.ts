type ReviewItem = { slug: string; title: string; summary: string; revision: number; updated_at: string; published_at?: string | null; cover_media_id?: string | null; category?: string | null; sources?: string | null };
const page = typeof document === "undefined" ? null : document.getElementById("blog-review-page") as HTMLElement;
const previewSlug = page?.dataset.slug ?? (typeof location === "undefined" ? null : location.pathname.match(/^\/desk\/blog\/([a-z0-9][a-z0-9-]{0,79})\/$/)?.[1] ?? null);
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
const pageSize = 20;
const categories = ["数字空间", "健康记录", "投资观察", "内容工作", "技术实践", "生活随笔"];
const listQuery = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
let activeTab: "pending" | "published" = listQuery.get("tab") === "published" ? "published" : "pending";
let activeCategory = listQuery.get("category") ?? "";
let activePage = Math.max(1, Number(listQuery.get("page") ?? "1") || 1);
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
function stateHref() {
  const params = new URLSearchParams();
  params.set("tab", activeTab);
  if (activeCategory) params.set("category", activeCategory);
  if (activePage > 1) params.set("page", String(activePage));
  return params.toString();
}
function renderListRow(item: ReviewItem, published: boolean, live = false) {
  const link = node("a", "", "desk-review-list-row");
  const query = stateHref();
  link.href = `/desk/blog/${encodeURIComponent(item.slug)}/${query ? `?${query}` : ""}`;
  link.dataset.slug = item.slug;
  link.append(reviewCover(item));
  const content = node("span", "", "desk-review-list-content");
  content.append(node("strong", item.title, "desk-queue-title"));
  const meta = node("span", "", "desk-review-list-meta");
  meta.append(node("span", item.category ? categoryNames[item.category] ?? item.category : "未分类", "desk-blog-chip"));
  meta.append(node("span", published ? "已上架" : live ? "已上架 · 有新版待审" : "待审", "desk-blog-chip desk-blog-chip-status"));
  meta.append(node("span", time(item.updated_at), "desk-queue-meta"));
  content.append(meta);
  link.append(content, node("span", published ? "查看 ›" : "去审核 ›", "desk-review-go"));
  return link;
}
function pushListState() {
  const query = stateHref();
  history.pushState(null, "", `/desk/blog/${query ? `?${query}` : ""}`);
  renderLists();
}
function renderLists() {
  const pending = queueItems;
  const published = publishedItems;
  const source = activeTab === "pending" ? pending : published;
  const filtered = activeCategory ? source.filter(item => (item.category ? categoryNames[item.category] ?? item.category : "未分类") === activeCategory) : source;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  activePage = Math.min(activePage, pages);
  const rows = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);
  const live = new Map(published.map(item => [item.slug, item]));
  const activeList = activeTab === "pending" ? el("blog-drafts-list") : el("blog-published-list");
  const inactiveList = activeTab === "pending" ? el("blog-published-list") : el("blog-drafts-list");
  activeList.replaceChildren(...(rows.length ? rows.map(item => renderListRow(item, activeTab === "published", live.has(item.slug))) : [node("p", activeTab === "pending" ? "暂无待审稿件。" : "暂无已上架文章。", "desk-review-empty")]));
  inactiveList.replaceChildren();
  for (const group of document.querySelectorAll<HTMLElement>("[data-review-tab]")) group.hidden = group.dataset.reviewTab !== activeTab;
  const tabs = el("blog-review-tabs");
  tabs.replaceChildren(...[
    ["pending", `待审 ${pending.length}`], ["published", `已上架 ${published.length}`],
  ].map(([value, label]) => { const button = node("button", label, "desk-blog-tab"); button.type = "button"; button.dataset.tab = value; button.setAttribute("aria-selected", String(value === activeTab)); button.addEventListener("click", () => { activeTab = value as "pending" | "published"; activeCategory = ""; activePage = 1; pushListState(); }); return button; }));
  const counts = new Map<string, number>();
  for (const item of source) { const category = item.category ? categoryNames[item.category] ?? item.category : "未分类"; counts.set(category, (counts.get(category) ?? 0) + 1); }
  const categoriesEl = el("blog-review-categories");
  categoriesEl.replaceChildren(...["全部", ...categories].map(category => { const button = node("button", `${category} ${category === "全部" ? source.length : counts.get(category) ?? 0}`, "desk-blog-category"); button.type = "button"; button.setAttribute("aria-pressed", String((category === "全部" ? !activeCategory : activeCategory === category))); button.addEventListener("click", () => { activeCategory = category === "全部" ? "" : category; activePage = 1; pushListState(); }); return button; }));
  const pager = el("blog-review-pagination");
  pager.replaceChildren();
  if (pages > 1) {
    const previous = node("button", "‹ 上一页", "desk-text-button");
    previous.disabled = activePage <= 1;
    previous.addEventListener("click", () => { activePage--; pushListState(); });
    pager.append(previous);
    if (matchMedia("(max-width: 720px)").matches) pager.append(node("span", `${activePage} / ${pages}`, "desk-fine"));
    else for (let index = 1; index <= pages; index++) { const button = node("button", String(index), index === activePage ? "kdp-button kdp-button--secondary desk-blog-page-current" : "desk-text-button"); button.type = "button"; button.setAttribute("aria-current", String(index === activePage)); button.addEventListener("click", () => { activePage = index; pushListState(); }); pager.append(button); }
    const next = node("button", "下一页 ›", "desk-text-button");
    next.disabled = activePage >= pages;
    next.addEventListener("click", () => { activePage++; pushListState(); });
    pager.append(next, node("span", "每页 20 篇", "desk-fine"));
  }
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
  page?.setAttribute("data-view", view);
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
  back.href = `/desk/blog/${typeof location === "undefined" ? "" : location.search}`;
  detail.append(back);
  const live = publishedItems.find(entry => entry.slug === item.slug);
  const hasLive = !!live;
  const updatingLive = !published && hasLive;
  const body = node("div", "", "desk-detail-body");
  body.dataset.slug = item.slug;
  body.dataset.revision = String(item.revision);
  const toolbar = node("div", "", "desk-detail-toolbar");
  const heading = node("div", "", "desk-detail-heading");
  heading.append(node("b", "审核", "desk-detail-label"), node("p", published ? "已上架" : hasLive ? "已上架 · 有新版待审" : "待审", "desk-review-meta"), node("h1", item.title));
  toolbar.append(heading);
  const button = node("button", published ? "下架" : updatingLive ? "审核通过，替换线上" : "审核通过，上架", published ? "kdp-button kdp-button--secondary" : "kdp-button");
  button.type = "button";
  button.dataset.reviewAction = published ? "unpublish" : "publish";
  toolbar.append(button);
  if (updatingLive && live) {
    const unpublish = node("button", "下架", "kdp-button kdp-button--secondary");
    unpublish.type = "button";
    unpublish.dataset.reviewAction = "unpublish";
    unpublish.dataset.revision = String(live.revision);
    toolbar.append(unpublish);
  }
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
      reviewMessage(message || `✓ ${queueItems.length} 篇待审，${published.total ?? publishedItems.length} 篇已上架。`);
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
  const revision = Number(button.dataset.revision ?? row.dataset.revision);
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
  const back = document.querySelector<HTMLAnchorElement>(".desk-blog-back");
  if (back && previewSlug) back.href = "/desk/blog/";
  clearPrivate();
  el("blog-review-login").hidden = true;
  try { await api("/api/desk/me"); active = true; el("blog-review-private").hidden = false; await loadReview(new URLSearchParams(location.search).get("result") === "published" ? "文章已上架。" : new URLSearchParams(location.search).get("result") === "unpublished" ? "文章已下架。" : ""); }
  catch (error) { if (!(error instanceof SessionExpired)) showLoginPage(); }
}
if (typeof document !== "undefined") {
  el("blog-review-detail").addEventListener("click", reviewAction);
  el("blog-review-status").setAttribute("aria-live", "polite");
  const retry = node("button", "↻ 重新读取", "desk-text-button desk-blog-retry");
  retry.type = "button";
  retry.addEventListener("click", () => { void loadReview(); });
  el("blog-review-status-row").append(retry);
  window.addEventListener("pagehide", clearPrivate);
  window.addEventListener("popstate", () => {
    if (previewSlug) return;
    const query = new URLSearchParams(location.search);
    activeTab = query.get("tab") === "published" ? "published" : "pending";
    activeCategory = query.get("category") ?? "";
    activePage = Math.max(1, Number(query.get("page") ?? "1") || 1);
    renderLists();
  });
  void initialize();
}
