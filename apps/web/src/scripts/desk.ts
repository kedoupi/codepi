import { products } from "@kedoupi/shared/products";
import type { DeskSummary, DeskSource } from "@kedoupi/shared/desk/contract";

type Payload = { generatedAt: string; partial: boolean; range: "current" | "week"; sources: DeskSummary[] };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const product = (id: DeskSource) => products.find(item => item.id === id)!;
const controllers = new Set<AbortController>();
let generation = 0;
let active = false;
let initializePromise: Promise<void> | null = null;
let summaryVersion = 0;
const emptyOutput = el("desk-summary-output").cloneNode(true) as HTMLElement;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}
function time(value: string | null) {
  if (!value) return "尚无记录";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
function resetSummary() {
  el("desk-digest-status").dataset.loading = "false";
  el("desk-summary-output").replaceChildren(...Array.from(emptyOutput.cloneNode(true).childNodes));
  el("desk-digest-status").textContent = "";
  el("desk-summary-output").setAttribute("aria-busy", "false");
}
function clearPrivate() {
  generation++;
  summaryVersion++;
  active = false;
  clearPreview();
  for (const controller of controllers) controller.abort();
  controllers.clear();
  el("desk-private").hidden = true;
  el("desk-actions").hidden = true;
  for (const target of document.querySelectorAll("[data-metrics], [data-note], [data-time], [data-private-metric]")) target.replaceChildren();
  el("desk-attention-list").replaceChildren();
  el("blog-drafts-list").replaceChildren();
  el("blog-review-detail").replaceChildren();
  queueItems = [];
  publishedItems = [];
  selectedSlug = null;
  el("blog-published-list").replaceChildren();
  el("blog-review-status").replaceChildren();
  for (const id of ["blog-drafts-list", "blog-published-list"]) el(id).setAttribute("aria-busy", "false");
  resetSummary();
  el<HTMLButtonElement>("desk-refresh").disabled = false;
  el<HTMLButtonElement>("desk-generate").disabled = false;
}
function showLogin(message: string) {
  clearPrivate();
  el("desk-login").hidden = false;
  el("desk-login-note").textContent = message;
}
class SessionExpired extends Error {}
async function api(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (response.status === 401) {
      showLogin("登录已到期或已退出，请重新登录后继续。");
      throw new SessionExpired();
    }
    if (!response.ok) {
      if (path.startsWith("/api/blog/")) {
        if (response.status === 409) throw Error("草稿已有新修订，请重新读取并预览后再审核。");
        if (response.status === 404) throw Error("这篇文章或草稿的状态已更改，请重新读取审核列表。");
        if (response.status === 400) throw Error("审核请求未通过校验，请重新读取草稿后重试。");
        if (response.status === 403) throw Error("当前登录没有执行此操作的权限，请重新登录。");
      }
      throw Error("连接暂不可用，请稍后重试。");
    }
    return await response.json();
  } finally { clearTimeout(timer); controllers.delete(controller); }
}
type ReviewItem = { slug: string; title: string; summary: string; revision: number; status?: string; updated_at: string; published_at?: string | null; category?: string | null; tags?: string | null; series?: string | null; sources?: string | null };
const categoryNames: Record<string, string> = {
  "digital-space": "数字空间", health: "健康记录", investing: "投资观察", content: "内容工作", tech: "技术实践", life: "生活随笔",
};
const sourceList = (value?: string | null): Array<{ title: string; url: string }> => {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.title === "string" && typeof item.url === "string") : []; } catch { return []; }
};
let queueItems: ReviewItem[] = [];
let publishedItems: ReviewItem[] = [];
let selectedSlug: string | null = null;
let reviewVersion = 0;
function reviewMessage(message: string, failed = false) {
  const status = el("blog-review-status");
  status.dataset.tone = failed ? "error" : "";
  status.textContent = message;
}
function reviewError(error: unknown) { return error instanceof Error && error.name !== "AbortError" ? error.message : "请求超时或连接中断，请重试。"; }
let previewCleanup: (() => void) | null = null;
function clearPreview() {
  previewCleanup?.();
  previewCleanup = null;
}
function previewFrame(item: ReviewItem) {
  const frame = document.createElement("iframe");
  frame.className = "desk-preview-frame";
  frame.title = `预览：${item.title}`;
  frame.loading = "eager";
  frame.src = `/blog/preview/${encodeURIComponent(item.slug)}/?embed=1`;
  const updateHeight = () => {
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (!documentElement) return;
    frame.style.height = `${Math.max(documentElement.scrollHeight, body?.scrollHeight ?? 0, 360)}px`;
  };
  const onLoad = () => {
    updateHeight();
    const documentElement = frame.contentDocument?.documentElement;
    const body = frame.contentDocument?.body;
    if (!documentElement) return;
    const resize = new ResizeObserver(updateHeight);
    resize.observe(documentElement);
    if (body) resize.observe(body);
    for (const image of frame.contentDocument?.images ?? []) image.addEventListener("load", updateHeight);
    previewCleanup = () => {
      resize.disconnect();
      for (const image of frame.contentDocument?.images ?? []) image.removeEventListener("load", updateHeight);
    };
  };
  frame.addEventListener("load", onLoad);
  return frame;
}
function appendSources(container: HTMLElement, value?: string | null) {
  const sources = sourceList(value);
  if (!sources.length) return;
  const section = node("section", "", "desk-review-sources");
  section.append(node("h4", "资料来源"));
  const list = node("ul");
  for (const source of sources) {
    const item = node("li");
    const link = node("a", source.title, "kdp-link");
    link.href = source.url;
    link.rel = "noopener noreferrer";
    item.append(link);
    list.append(item);
  }
  section.append(list);
  container.append(section);
}
function renderReview(item: ReviewItem, publishedItem = false, liveRevision?: number) {
  const row = node("article", "", "desk-review-item");
  row.dataset.slug = item.slug;
  row.dataset.revision = String(item.revision);
  const content = node("div", "", "desk-review-content");
  content.append(node("h3", item.title));
  const state = publishedItem ? "已上架" : liveRevision !== undefined ? "已上架 · 有新版待审" : "待审";
  content.append(node("p", `${state} · 修订 ${item.revision}`, "desk-review-meta"));
  content.append(node("p", `更新于 ${time(item.updated_at)}（北京时间）`, "desk-review-meta"), node("p", item.summary));
  if (!publishedItem && liveRevision !== undefined) content.append(node("p", "线上仍是旧版，通过后替换。", "desk-review-notice"));
  if (item.category) content.append(node("p", `自动分类：${categoryNames[item.category] ?? item.category}`, "desk-review-meta"));
  appendSources(content, item.sources);
  const actions = node("div", "", "desk-review-actions");
  const preview = node("a", publishedItem ? "查看文章" : "预览稿件", "kdp-link");
  preview.href = publishedItem ? `/blog/${encodeURIComponent(item.slug)}/` : `/blog/preview/${encodeURIComponent(item.slug)}/?embed=1`;
  actions.append(preview);
  const button = node("button", publishedItem ? "下架" : "通过上架", publishedItem ? "kdp-button kdp-button--secondary" : "kdp-button");
  button.type = "button";
  button.dataset.reviewAction = publishedItem ? "unpublish" : "publish";
  actions.append(button);
  content.append(actions);
  row.append(content);
  if (publishedItem && item.slug === selectedSlug) row.setAttribute("aria-current", "true");
  return row;
}
function renderQueue() {
  const list = el("blog-drafts-list");
  if (!queueItems.length) {
    list.replaceChildren(node("p", "暂无待审稿件。通过 MCP 提交的稿件会出现在这里。", "desk-review-empty"));
    return;
  }
  const live = new Map(publishedItems.map(item => [item.slug, item]));
  list.replaceChildren(...queueItems.map(item => {
    const button = node("button", "", "desk-queue-item");
    button.type = "button";
    button.dataset.slug = item.slug;
    button.dataset.revision = String(item.revision);
    if (item.slug === selectedSlug) button.setAttribute("aria-current", "true");
    const liveItem = live.get(item.slug);
    button.append(node("span", item.title, "desk-queue-title"), node("span", `${liveItem ? "已上架 · 有新版待审" : "待审"} · 修订 ${item.revision} · ${time(item.updated_at)}`, "desk-queue-meta"));
    return button;
  }));
}
function renderDetail(item: ReviewItem | null, publishedItem = false) {
  const detail = el("blog-review-detail");
  clearPreview();
  detail.replaceChildren();
  if (!item) {
    detail.append(node("p", "选择稿件，在这里预览标题、分类和完整文章。", "desk-review-empty"));
    return;
  }
  const back = node("button", "← 返回列表", "desk-text-button desk-detail-back");
  back.type = "button";
  back.addEventListener("click", () => { selectedSlug = null; setReviewView("list"); renderQueue(); renderDetail(null); });
  detail.append(back);
  const live = publishedItems.find(entry => entry.slug === item.slug);
  const body = node("div", "", "desk-detail-body");
  body.dataset.slug = item.slug;
  body.dataset.revision = String(item.revision);
  const toolbar = node("div", "", "desk-detail-toolbar");
  const heading = node("div", "", "desk-detail-heading");
  heading.append(node("p", publishedItem ? "已上架" : live ? "已上架 · 有新版待审" : "待审", "desk-review-meta"), node("h3", item.title));
  toolbar.append(heading);
  const button = node("button", publishedItem ? "下架" : "通过上架", publishedItem ? "kdp-button kdp-button--secondary" : "kdp-button");
  button.type = "button";
  button.dataset.reviewAction = publishedItem ? "unpublish" : "publish";
  toolbar.append(button);
  body.append(toolbar);
  if (!publishedItem && live) body.append(node("aside", "线上仍是旧版，通过后替换。", "desk-review-notice"));
  body.append(previewFrame(item));
  detail.append(body);
}
function setReviewView(view: "list" | "detail") {
  const workspace = el("blog-review-workspace");
  workspace.dataset.view = view;
  workspace.closest<HTMLElement>(".desk-review")?.setAttribute("data-view", view);
}
function selectDraft(slug: string) {
  selectedSlug = slug;
  setReviewView("detail");
  renderQueue();
  renderDetail(queueItems.find(item => item.slug === slug) ?? null);
}
function selectPublished(slug: string) {
  selectedSlug = slug;
  setReviewView("detail");
  renderQueue();
  renderDetail(publishedItems.find(item => item.slug === slug) ?? null, true);
}
el("blog-drafts-list").addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-slug]");
  if (button) selectDraft(button.dataset.slug!);
});
el("blog-published-list").addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("[data-review-action], a")) return;
  const row = target.closest<HTMLElement>("[data-slug]");
  if (row?.dataset.slug) selectPublished(row.dataset.slug);
});
async function loadReview(message = "") {
  if (!active) return;
  const current = generation;
  const version = ++reviewVersion;
  reviewMessage("正在读取博客审核列表…");
  for (const id of ["blog-drafts-list", "blog-published-list"]) el(id).setAttribute("aria-busy", "true");
  try {
    const [drafts, published] = await Promise.all([
      api("/api/blog/drafts") as Promise<{ drafts: ReviewItem[] }>,
      api("/api/blog/posts") as Promise<{ posts: ReviewItem[]; total: number }>,
    ]);
    if (current !== generation || version !== reviewVersion || !active) return;
    queueItems = drafts.drafts;
    publishedItems = published.posts;
    if (selectedSlug && !queueItems.some(item => item.slug === selectedSlug) && !publishedItems.some(item => item.slug === selectedSlug)) selectedSlug = null;
    setReviewView(selectedSlug ? "detail" : "list");
    el("blog-published-list").replaceChildren(...(publishedItems.length ? publishedItems.map(item => renderReview(item, true)) : [node("p", "暂无已上架文章。", "desk-review-empty")]));
    renderQueue();
    const selectedDraft = queueItems.find(item => item.slug === selectedSlug);
    const selectedPublished = publishedItems.find(item => item.slug === selectedSlug);
    renderDetail(selectedDraft ?? selectedPublished ?? null, !selectedDraft && !!selectedPublished);
    reviewMessage(message || `${queueItems.length} 篇待审，${published.total ?? publishedItems.length} 篇已上架。`);
  } catch (error) {
    if (current === generation && version === reviewVersion && !(error instanceof SessionExpired)) reviewMessage(`博客审核暂时无法读取。${reviewError(error)} 可点击“重新读取”重试。`, true);
  } finally {
    if (current === generation && version === reviewVersion) for (const id of ["blog-drafts-list", "blog-published-list"]) el(id).setAttribute("aria-busy", "false");
  }
}
async function reviewAction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-review-action]");
  const row = button?.closest<HTMLElement>("[data-slug]");
  if (!active || !button || !row || button.disabled) return;
  const action = button.dataset.reviewAction;
  if (!action || !["publish", "unpublish"].includes(action)) return;
  const title = row.querySelector("h3")?.textContent ?? "这篇文章";
  const revision = Number(row.dataset.revision);
  const confirmation = action === "publish" ? `通过上架《${title}》的修订 ${revision}？文章及图片将公开可见。` : `下架《${title}》？公开页面将无法访问。`;
  if (!window.confirm(confirmation)) return;
  const current = generation;
  const controls = row.querySelectorAll<HTMLButtonElement>("button");
  controls.forEach(control => { control.disabled = true; });
  row.setAttribute("aria-busy", "true");
  reviewMessage(action === "publish" ? "正在通过上架…" : "正在下架…");
  try {
    const slug = encodeURIComponent(row.dataset.slug!);
    const endpoint = action === "publish" ? `/api/blog/drafts/${slug}/publish` : `/api/blog/posts/${slug}/unpublish`;
    await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    if (current !== generation || !active) return;
    reviewMessage(action === "publish" ? "文章已上架。" : "文章已下架。");
    await loadReview(action === "publish" ? "文章已上架。" : "文章已下架。");
  } catch (error) {
    if (current === generation && active && !(error instanceof SessionExpired)) reviewMessage(`${reviewError(error)} 可点击“重新读取”获取最新状态。`, true);
  } finally {
    if (current === generation && active) {
      row.setAttribute("aria-busy", "false");
      controls.forEach(control => { control.disabled = false; });
    }
  }
}
el("blog-review-status").setAttribute("aria-live", "polite");
const reviewRetry = node("button", "重新读取", "desk-text-button");
reviewRetry.type = "button";
reviewRetry.addEventListener("click", () => { void loadReview(); });
el("blog-review-status").after(reviewRetry);
el("blog-drafts-list").addEventListener("click", reviewAction);
el("blog-published-list").addEventListener("click", reviewAction);
el("blog-review-detail").addEventListener("click", reviewAction);
function renderOverview(payload: Payload) {
  for (const data of payload.sources) {
    const card = document.querySelector<HTMLElement>(`[data-source="${data.source}"]`)!;
    const state = card.querySelector<HTMLElement>("[data-state]")!;
    state.textContent = data.status === "unavailable" ? "暂不可用" : data.status === "empty" ? "暂无数据" : data.stale ? "请核对时效" : "已读取";
    state.dataset.tone = data.stale || data.status === "unavailable" ? "warning" : "";
    const metrics = card.querySelector("[data-metrics]")!;
    metrics.replaceChildren();
    for (const metric of data.metrics) {
      const item = node("div");
      item.append(node("dt", metric.label), node("dd", metric.value));
      metrics.append(item);
    }
    card.querySelector("[data-note]")!.textContent = data.notes.join(" ");
    card.querySelector("[data-time]")!.textContent = data.status === "ok"
      ? `${data.source === "gu" ? "批次" : "记录"}：${time(data.asOf)}` : "";
    const privateSlot = card.querySelector("[data-private-metric]")!;
    privateSlot.replaceChildren();
    if (data.privateMetric) {
      const details = node("details");
      details.append(node("summary", "查看资产金额"), node("p", `${data.privateMetric.label}：${data.privateMetric.value}`));
      privateSlot.append(details);
    }
  }
  const list = el("desk-attention-list");
  list.replaceChildren();
  for (const data of payload.sources) {
    const tasks = data.status === "unavailable"
      ? [{ label: "摘要暂不可用，进入应用查看", href: product(data.source).href }] : data.attention;
    for (const task of tasks) {
      const item = node("li");
      const link = node("a");
      link.href = task.href;
      link.append(node("small", product(data.source).name), node("span", task.label + " ↗"));
      item.append(link);
      list.append(item);
    }
  }
  el("desk-attention-empty").hidden = list.childElementCount > 0;
  el("desk-attention-empty").textContent = payload.sources.every(source => source.status === "empty")
    ? "还没有可用于判断待处理事项的数据。" : "已读取的状态中，暂无待处理事项。";
  el("desk-status").dataset.loading = "false";
  el("desk-status").textContent = `${payload.partial ? "部分来源暂不可用" : "概览已读取"} · ${time(payload.generatedAt)}（北京时间）`;
  document.querySelector(".desk-overview")!.setAttribute("aria-busy", "false");
}
async function refresh() {
  if (!active) return;
  const current = generation;
  summaryVersion++;
  resetSummary();
  el("desk-digest-status").textContent = "正在读取新的概览；需要时可重新生成摘要。";
  el<HTMLButtonElement>("desk-refresh").disabled = true;
  el<HTMLButtonElement>("desk-generate").disabled = true;
  document.querySelector(".desk-overview")!.setAttribute("aria-busy", "true");
  el("desk-status").dataset.loading = "true";
  el("desk-status").textContent = "正在读取各应用已有记录…";
  try {
    const result = await api("/api/desk/overview") as Payload;
    if (current === generation && active) renderOverview(result);
  } catch (error) {
    if (current === generation && !(error instanceof SessionExpired)) {
      // Do not leave an old private snapshot labelled as current after a failed refresh.
      showLogin("暂时无法验证或读取工作台，数据已隐藏。请重新检查连接。");
      el("desk-status").dataset.loading = "false";
      el("desk-status").textContent = "工作台连接暂不可用。";
    }
  } finally {
    if (current === generation) {
      el<HTMLButtonElement>("desk-refresh").disabled = false;
      el<HTMLButtonElement>("desk-generate").disabled = false;
      document.querySelector(".desk-overview")!.setAttribute("aria-busy", "false");
    }
  }
}
function initialize() {
  if (initializePromise) return initializePromise;
  const task = (async () => {
    clearPrivate();
    const current = generation;
    el("desk-login").hidden = true;
    el("desk-status").dataset.loading = "true";
    el("desk-status").textContent = "正在确认登录状态…";
    try {
      await api("/api/desk/me");
      if (current !== generation) return;
      active = true;
      el("desk-private").hidden = false;
      el("desk-actions").hidden = false;
      await refresh();
      await loadReview();
    } catch (error) {
      if (current === generation && !(error instanceof SessionExpired)) {
        showLogin("工作台连接暂不可用。若首次部署尚未完成，请稍后重新检查连接。");
      }
      el("desk-status").dataset.loading = "false";
      el("desk-status").textContent = "";
    }
  })();
  initializePromise = task;
  void task.then(
    () => { if (initializePromise === task) initializePromise = null; },
    () => { if (initializePromise === task) initializePromise = null; },
  );
  return task;
}
el<HTMLFormElement>("desk-summary-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!active) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const sources = form.getAll("sources");
  if (!sources.length) { el("desk-digest-status").textContent = "请至少选择一个应用。"; return; }
  const current = generation;
  const version = ++summaryVersion;
  el<HTMLButtonElement>("desk-generate").disabled = true;
  el("desk-summary-output").setAttribute("aria-busy", "true");
  el("desk-digest-status").dataset.loading = "true";
  el("desk-digest-status").textContent = "正在整理所选应用的记录…";
  el("desk-summary-output").replaceChildren();
  try {
    const result = await api("/api/desk/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range: form.get("range"), sources }),
    }) as Payload;
    if (current !== generation || version !== summaryVersion || !active) return;
    for (const data of result.sources) {
      const section = node("section", "", "desk-summary-section");
      section.append(node("h3", product(data.source).name));
      section.append(node("p", `数据日期：${time(data.asOf)}`, "desk-fine"));
      const facts = node("ul");
      for (const fact of data.facts) facts.append(node("li", fact));
      section.append(facts);
      for (const note of data.notes) section.append(node("p", note, "desk-fine"));
      const link = node("a", "进入" + product(data.source).shortName + " ↗", "kdp-link");
      link.href = product(data.source).href;
      section.append(link);
      el("desk-summary-output").append(section);
    }
    el("desk-digest-status").dataset.loading = "false";
    el("desk-digest-status").textContent = `${result.partial ? "部分完成" : "摘要已生成"} · ${result.range === "week" ? "最近 7 天（快照来源单独标注）" : "当前概览"} · ${time(result.generatedAt)}`;
  } catch (error) {
    if (current === generation && version === summaryVersion && !(error instanceof SessionExpired)) {
      el("desk-digest-status").dataset.loading = "false";
      el("desk-digest-status").textContent = "摘要暂时无法生成，请重试。";
    }
  } finally {
    if (current === generation && version === summaryVersion) {
      el<HTMLButtonElement>("desk-generate").disabled = false;
      el("desk-summary-output").setAttribute("aria-busy", "false");
    }
  }
});
el("desk-summary-form").addEventListener("change", () => {
  summaryVersion++;
  resetSummary();
  el<HTMLButtonElement>("desk-generate").disabled = false;
  el("desk-digest-status").dataset.loading = "false";
  el("desk-digest-status").textContent = "范围已更改，请生成新的摘要。";
});
async function logout() {
  clearPrivate();
  el("desk-login").hidden = false;
  el("desk-login-note").textContent = "正在退出统一登录…";
  el<HTMLButtonElement>("desk-logout-retry").disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
    el("desk-login-note").textContent = "已退出此浏览器的统一登录，工作台数据已清除。";
    el("desk-logout-retry").hidden = true;
    el("desk-status").dataset.loading = "false";
    el("desk-status").textContent = "";
  } catch {
    el("desk-login-note").textContent = "页面数据已隐藏，但退出尚未完成。请重试退出登录。";
    el("desk-logout-retry").hidden = false;
  } finally { el<HTMLButtonElement>("desk-logout-retry").disabled = false; }
}
el("desk-refresh").addEventListener("click", refresh);
el("desk-retry").addEventListener("click", initialize);
el("desk-logout").addEventListener("click", logout);
el("desk-logout-retry").addEventListener("click", logout);
el("desk-date").textContent = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" }) + " · 北京时间";
window.addEventListener("pagehide", clearPrivate);
window.addEventListener("pageshow", event => { if (event.persisted) void initialize(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearPrivate();
  else void initialize();
});
setInterval(async () => {
  if (!active || document.hidden) return;
  const current = generation;
  try { await api("/api/desk/me"); }
  catch { if (current === generation) showLogin("会话暂时无法验证，数据已隐藏，请重新检查连接。"); }
}, 60000);
void initialize();
