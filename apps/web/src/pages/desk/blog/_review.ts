type ReviewItem = { slug: string; title: string; summary: string; revision: number; updated_at: string; published_at?: string | null; cover_media_id?: string | null; category?: string | null; sources?: string | null; has_live?: number | boolean; live_revision?: number | null };
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
let queueItems: ReviewItem[] = [], publishedItems: ReviewItem[] = [], pendingMeta = { total: 0, page: 1, pages: 1, counts: {} as Record<string, number> }, publishedMeta = { total: 0, page: 1, pages: 1, counts: {} as Record<string, number> }, selectedSlug: string | null = previewSlug, active = false, generation = 0, previewCleanup: (() => void) | null = null;
const pageSize = 20;
const categories = ["digital-space", "health", "investing", "content", "tech", "life"] as const;
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
  meta.append(node("span", published ? live ? "有新版待审" : "已上架" : live ? "已上架 · 有新版待审" : "待审", "desk-blog-chip desk-blog-chip-status"));
  meta.append(node("span", time(item.updated_at), "desk-queue-meta"));
  content.append(meta);
  link.append(content, node("span", published ? "查看 ›" : "去审核 ›", "desk-review-go"));
  return link;
}
function renderLists() {
  const pending = queueItems;
  const published = publishedItems;
  const source = activeTab === "pending" ? pending : published;
  const meta = activeTab === "pending" ? pendingMeta : publishedMeta;
  activePage = meta.page;
  const live = new Map(published.map(item => [item.slug, item]));
  const activeList = activeTab === "pending" ? el("blog-drafts-list") : el("blog-published-list");
  const inactiveList = activeTab === "pending" ? el("blog-published-list") : el("blog-drafts-list");
  const rows = source.length ? source.map(item => renderListRow(item, activeTab === "published", live.has(item.slug) || !!item.has_live)) : [node("p", activeCategory ? "这个分类还没有文章" : activeTab === "pending" ? "没有待审的稿件，去看看已上架 ›" : "这个分类还没有文章", "desk-review-empty")];
  activeList.replaceChildren(...rows);
  inactiveList.replaceChildren();
  for (const group of document.querySelectorAll<HTMLElement>("[data-review-tab]")) group.hidden = group.dataset.reviewTab !== activeTab;
  const tabs = el("blog-review-tabs");
  tabs.replaceChildren(...[["pending", `待审 ${pendingMeta.total}`], ["published", `已上架 ${publishedMeta.total}`]].map(([value, label]) => { const button = node("button", label, "desk-blog-tab"); button.type = "button"; button.dataset.tab = value; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(value === activeTab)); button.addEventListener("click", () => { activeTab = value as "pending" | "published"; activeCategory = ""; activePage = 1; pushListState(); void loadReview(); }); return button; }));
  const categoriesEl = el("blog-review-categories");
  categoriesEl.replaceChildren(...["", ...categories].map(category => { const name = category ? categoryNames[category] : "全部"; const count = category ? meta.counts[category] ?? 0 : meta.total; const button = node("button", `${name} ${count}`, "desk-blog-category"); button.type = "button"; button.dataset.category = category; button.setAttribute("aria-pressed", String(category ? activeCategory === category : !activeCategory)); if (category && count === 0) button.classList.add("desk-blog-category-zero"); button.addEventListener("click", () => { activeCategory = category; activePage = 1; pushListState(); void loadReview(); }); return button; }));
  const pager = el("blog-review-pagination");
  pager.replaceChildren();
  if (meta.pages > 1) {
    const previous = node("button", "‹ 上一页", "desk-blog-page-button"); previous.disabled = activePage <= 1; previous.addEventListener("click", () => { activePage--; pushListState(); void loadReview(); }); pager.append(previous);
    const mobilePager = matchMedia("(max-width: 720px)").matches;
    if (mobilePager) pager.append(node("span", `${meta.page} / ${meta.pages}`, "desk-fine"));
    else for (let index = 1; index <= meta.pages; index++) { const button = node("button", String(index), index === meta.page ? "desk-blog-page-button desk-blog-page-current" : "desk-blog-page-button"); button.type = "button"; button.setAttribute("aria-current", index === meta.page ? "page" : "false"); button.addEventListener("click", () => { activePage = index; pushListState(); void loadReview(); }); pager.append(button); }
    const next = node("button", "下一页 ›", "desk-blog-page-button"); next.disabled = activePage >= meta.pages; next.addEventListener("click", () => { activePage++; pushListState(); void loadReview(); }); pager.append(next); if (!mobilePager) pager.append(node("span", "每页 20 篇", "desk-fine"));
  }
  if (activeCategory) document.querySelector<HTMLElement>('.desk-blog-category[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
}
function pushListState() { const query = stateHref(); history.pushState(null, "", `/desk/blog/${query ? `?${query}` : ""}`); }
function previewFrame(item: ReviewItem) {
  const frame = document.createElement("iframe");
  frame.className = "desk-preview-frame";
  frame.title = `预览：${item.title}`;
  frame.loading = "eager";
  frame.src = `/blog/preview/${encodeURIComponent(item.slug)}/?embed=1`;
  const resize = () => {
    window.requestAnimationFrame(() => {
      const documentElement = frame.contentDocument?.documentElement;
      const body = frame.contentDocument?.body;
      if (documentElement) frame.style.height = `${Math.max(documentElement.scrollHeight, body?.scrollHeight ?? 0, 360)}px`;
    });
  };
  frame.addEventListener("load", () => {
    clearPreview();
    resize();
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    const frameWindow = frame.contentWindow;
    if (!documentElement) return;
    const observer = new ResizeObserver(resize);
    observer.observe(documentElement);
    if (body) observer.observe(body);
    frameWindow?.addEventListener("resize", resize);
    for (const image of frame.contentDocument?.images ?? []) image.addEventListener("load", resize);
    previewCleanup = () => {
      observer.disconnect();
      frameWindow?.removeEventListener("resize", resize);
      for (const image of frame.contentDocument?.images ?? []) image.removeEventListener("load", resize);
    };
  });
  return frame;
}
function setView(view: "list" | "detail") {
  page?.setAttribute("data-view", view);
  document.body.dataset.blogReviewView = view;
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
function renderDetail(item: ReviewItem | null, published = false, draftHasLive = false, draftLiveRevision: number | null = null) {
  const detail = el("blog-review-detail");
  clearPreview();
  detail.replaceChildren();
  if (!item) return;
  const back = node("a", "← 返回列表", "desk-text-button desk-detail-back");
  back.href = `/desk/blog/${typeof location === "undefined" ? "" : location.search}`;
  detail.append(back);
  const live = publishedItems.find(entry => entry.slug === item.slug);
  const hasLive = !!live || draftHasLive;
  const liveRevision = live?.revision ?? draftLiveRevision;
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
  if (updatingLive) {
    const unpublish = node("button", "下架", "kdp-button kdp-button--secondary");
    unpublish.type = "button";
    unpublish.dataset.reviewAction = "unpublish";
    if (liveRevision) unpublish.dataset.revision = String(liveRevision);
    toolbar.append(unpublish);
  }
  body.append(toolbar);
  if (!published && hasLive) body.append(node("aside", "线上仍是旧版，通过后替换。", "desk-review-notice"));
  body.append(previewFrame(item));
  detail.append(body);
}
async function loadReview(message = "") {
  if (!active) return;
  const current = generation;
  try {
    if (previewSlug) {
      const [draftResult, postResult] = await Promise.allSettled([api(`/api/blog/drafts/${encodeURIComponent(previewSlug)}`) as Promise<{ draft: ReviewItem; has_live?: boolean; live_revision?: number | null }>, api(`/api/blog/posts/${encodeURIComponent(previewSlug)}`) as Promise<{ post: ReviewItem }>]);
      if (current !== generation || !active) return;
      const draft = draftResult.status === "fulfilled" ? draftResult.value.draft : null;
      const draftHasLive = draftResult.status === "fulfilled" && !!draftResult.value.has_live;
      const draftLiveRevision = draftResult.status === "fulfilled" ? draftResult.value.live_revision ?? null : null;
      let live = postResult.status === "fulfilled" ? postResult.value.post : null;
      if (!live) {
        const published = await api("/api/blog/posts?tab=published&page=1") as { posts: ReviewItem[] };
        live = published.posts.find(item => item.slug === previewSlug) ?? null;
      }
      if (!draft && !live) { reviewMessage("稿件不存在或已被移除。", true); return; }
      setView("detail");
      renderDetail(draft ?? live ?? null, !draft && !!live, draftHasLive, draftLiveRevision);
      reviewMessage(message || `${!draft && live ? "已上架" : "待审"} · 修订 ${(draft ?? live)!.revision}`);
      return;
    }
    const query = new URLSearchParams({ tab: "pending", page: String(activePage) });
    if (activeCategory) query.set("category", activeCategory);
    const publishedQuery = new URLSearchParams({ tab: "published", page: String(activeTab === "published" ? activePage : 1) });
    if (activeCategory) publishedQuery.set("category", activeCategory);
    const [drafts, published] = await Promise.all([
      api(`/api/blog/drafts?${query}`) as Promise<{ drafts: ReviewItem[]; total: number; page: number; pages: number; counts: Record<string, number> }>,
      api(`/api/blog/posts?${publishedQuery}`) as Promise<{ posts: ReviewItem[]; total: number; page: number; pages: number; counts: Record<string, number> }>,
    ]);
    if (current !== generation || !active) return;
    queueItems = drafts.drafts;
    publishedItems = published.posts;
    pendingMeta = { total: drafts.total, page: drafts.page, pages: drafts.pages, counts: drafts.counts };
    publishedMeta = { total: published.total, page: published.page, pages: published.pages, counts: published.counts };
    if (activeTab === "pending" && pendingMeta.total === 0) { activeTab = "published"; activePage = 1; await loadReview(message); return; }
    setView("list");
    renderLists();
    reviewMessage(message || `✓ ${pendingMeta.total} 篇待审，${publishedMeta.total} 篇已上架。`);
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
    const result = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
    result.set("result", action === "publish" ? "published" : "unpublished");
    window.location.href = `/desk/blog/?${result}`;
  } catch (error) { if (!(error instanceof SessionExpired)) { button.disabled = false; reviewMessage("操作暂时无法完成，请重试。", true); } }
}
function showLoginPage() { clearPrivate(); el("blog-review-login").hidden = false; }
async function initialize() {
  const back = document.querySelector<HTMLAnchorElement>(".desk-blog-back");
  if (previewSlug) {
    const login = document.querySelector<HTMLAnchorElement>("#blog-review-login a");
    if (login) login.href = `/api/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (back && previewSlug) back.href = "/desk/blog/";
  clearPrivate();
  el("blog-review-login").hidden = true;
  try { await api("/api/desk/me"); active = true; el("blog-review-private").hidden = false; await loadReview(new URLSearchParams(location.search).get("result") === "published" ? "文章已上架。" : new URLSearchParams(location.search).get("result") === "unpublished" ? "文章已下架。" : ""); }
  catch (error) { if (!(error instanceof SessionExpired)) showLoginPage(); }
}
if (typeof document !== "undefined") {
  el("blog-drafts-list").addEventListener("click", event => { const target = event.target; if (target instanceof HTMLElement) { const row = target.closest<HTMLAnchorElement>("[data-slug]"); if (row) { event.preventDefault(); window.location.href = row.href; } } });
  el("blog-published-list").addEventListener("click", event => { const target = event.target; if (target instanceof HTMLElement) { const row = target.closest<HTMLAnchorElement>("[data-slug]"); if (row) { event.preventDefault(); window.location.href = row.href; } } });
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
