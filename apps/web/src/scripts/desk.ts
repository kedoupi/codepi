import { products } from "@kedoupi/shared/products";
import type { DeskSummary, DeskSource } from "@kedoupi/shared/desk/contract";
import { renderMermaid } from "./blog";

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
  for (const controller of controllers) controller.abort();
  controllers.clear();
  el("desk-private").hidden = true;
  el("desk-actions").hidden = true;
  for (const target of document.querySelectorAll("[data-metrics], [data-note], [data-time], [data-private-metric]")) target.replaceChildren();
  el("desk-attention-list").replaceChildren();
  el("blog-drafts-list").replaceChildren();
  el("blog-published-list").replaceChildren();
  el("blog-archived-list").replaceChildren();
  el("blog-review-status").replaceChildren();
  for (const id of ["blog-drafts-list", "blog-published-list", "blog-archived-list"]) el(id).setAttribute("aria-busy", "false");
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
type ReviewItem = { slug: string; title: string; summary: string; revision: number; status?: string; client_name?: string | null; review_note?: string | null; updated_at: string; published_at?: string | null; cover_media_id?: string | null; body_html?: string | null; is_test?: number; archived_at?: string | null; category?: string | null; tags?: string | null; series?: string | null };
type Category = { slug: string; name: string; published: number };
let categoriesCache: Category[] = [];
const tagList = (value?: string | null): string[] => { try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : []; } catch { return []; } };
let reviewVersion = 0;
function reviewMessage(message: string, failed = false) {
  const status = el("blog-review-status");
  status.dataset.tone = failed ? "error" : "";
  status.textContent = message;
}
function reviewError(error: unknown) { return error instanceof Error && error.name !== "AbortError" ? error.message : "请求超时或连接中断，请重试。"; }
function renderReview(item: ReviewItem, publishedItem = false, liveRevision?: number, inactive = false) {
  const row = node("article", "", "desk-review-item");
  row.dataset.slug = item.slug;
  row.dataset.revision = String(item.revision);
  const content = node("div", "", "desk-review-content");
  if (item.cover_media_id) {
    const image = node("img", "", "desk-review-cover");
    image.src = `/blog/media/${encodeURIComponent(item.cover_media_id)}`;
    image.alt = "";
    image.loading = "lazy";
    row.append(image);
  }
  content.append(node("h3", item.title));
  const state = publishedItem ? "已发布" : inactive ? item.is_test ? "测试稿件" : "已归档" : item.status === "rejected" ? "已拒绝" : liveRevision !== undefined ? "更新待审核" : "待审核";
  content.append(node("p", `${state} · 修订 ${item.revision}${!publishedItem ? ` · ${item.client_name ?? "MCP"}` : ""}`, "desk-review-meta"));
  content.append(node("p", `更新于 ${time(item.updated_at)}（北京时间）`, "desk-review-meta"), node("p", item.summary));
  if (!publishedItem && liveRevision !== undefined) content.append(node("p", `当前公开版本为修订 ${liveRevision}，发布更新前继续保留。`, "desk-fine"));
  if (item.review_note) content.append(node("p", `审阅说明：${item.review_note}`, "desk-review-note"));
  const taxonomy = [item.category ? categoriesCache.find(category => category.slug === item.category)?.name ?? item.category : "", ...tagList(item.tags)].filter(Boolean).join(" · ");
  if (taxonomy) content.append(node("p", taxonomy, "desk-review-meta"));
  if (item.series) content.append(node("p", `系列：${item.series}`, "desk-review-meta"));
  if (!publishedItem && !inactive && item.status !== "rejected") {
    const form = node("div", "", "desk-review-taxonomy");
    const categoryLabel = node("label", "分类");
    const select = node("select");
    select.name = "category";
    select.append(new Option("未分类", ""));
    for (const category of categoriesCache) select.append(new Option(category.name, category.slug, false, category.slug === item.category));
    categoryLabel.append(select);
    const tagsLabel = node("label", "标签（1–5 个，逗号分隔）");
    const tagsInput = node("input");
    tagsInput.name = "tags";
    tagsInput.value = tagList(item.tags).join("，");
    tagsInput.maxLength = 220;
    tagsLabel.append(tagsInput);
    const seriesLabel = node("label", "系列（可选）");
    const seriesInput = node("input");
    seriesInput.name = "series";
    seriesInput.value = item.series ?? "";
    seriesInput.maxLength = 40;
    seriesLabel.append(seriesInput);
    const save = node("button", "保存分类与标签", "desk-text-button");
    save.type = "button";
    save.dataset.reviewAction = "metadata";
    form.append(categoryLabel, tagsLabel, seriesLabel, save);
    content.append(form);
  }
  if (!publishedItem && item.body_html) {
    const details = node("details", "", "desk-review-full");
    const article = node("div", "", "personal-article-content");
    details.append(node("summary", "阅读全文与配图"), article);
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) return;
      loaded = true;
      // The same server-sanitized snapshot the public article page renders.
      article.innerHTML = item.body_html!;
      void renderMermaid(article);
    });
    content.append(details);
  }
  const actions = node("div", "", "desk-review-actions");
  const preview = node("a", publishedItem ? "查看文章" : "预览草稿", "kdp-link");
  preview.href = publishedItem ? `/blog/${encodeURIComponent(item.slug)}/` : `/blog/preview/${encodeURIComponent(item.slug)}/`;
  actions.append(preview);
  if (inactive) {
    const button = node("button", "恢复到审核队列", "kdp-button kdp-button--secondary");
    button.type = "button";
    button.dataset.reviewAction = "restore";
    actions.append(button);
  } else if (!publishedItem && item.status !== "rejected") {
    const label = node("label", "审阅说明（拒绝时可选）", "desk-review-note-label");
    const note = node("textarea");
    note.name = "review-note";
    note.rows = 2;
    note.maxLength = 1000;
    label.append(note);
    content.append(label);
    for (const [action, text, className] of [["publish", liveRevision !== undefined ? "发布更新" : "发布", "kdp-button"], ["reject", "拒绝", "kdp-button kdp-button--secondary"]]) {
      const button = node("button", text, className);
      button.type = "button";
      button.dataset.reviewAction = action;
      actions.append(button);
    }
  } else if (publishedItem) {
    const button = node("button", "下架", "kdp-button kdp-button--secondary");
    button.type = "button";
    button.dataset.reviewAction = "unpublish";
    actions.append(button);
  }
  if (!publishedItem) {
    const archive = node("button", "归档", "desk-text-button");
    archive.type = "button";
    archive.dataset.reviewAction = "archive";
    actions.append(archive);
  }
  content.append(actions);
  row.append(content);
  return row;
}
async function loadReview(message = "") {
  if (!active) return;
  const current = generation;
  const version = ++reviewVersion;
  reviewMessage("正在读取博客审核列表…");
  for (const id of ["blog-drafts-list", "blog-published-list", "blog-archived-list"]) el(id).setAttribute("aria-busy", "true");
  try {
    const [drafts, published, inactive, categories] = await Promise.all([
      api("/api/blog/drafts") as Promise<{ drafts: ReviewItem[] }>,
      api("/api/blog/posts") as Promise<{ posts: ReviewItem[]; total: number }>,
      api("/api/blog/drafts?view=archived") as Promise<{ drafts: ReviewItem[] }>,
      api("/api/blog/categories") as Promise<{ categories: Category[] }>,
    ]);
    if (current !== generation || version !== reviewVersion || !active) return;
    categoriesCache = categories.categories;
    renderCategories();
    const live = new Map(published.posts.map(item => [item.slug, item.revision]));
    el("blog-drafts-list").replaceChildren(...(drafts.drafts.length ? drafts.drafts.map(item => renderReview(item, false, live.get(item.slug))) : [node("p", "暂无待审核的草稿。通过 MCP 提交的草稿会出现在这里。", "desk-review-empty")]));
    el("blog-published-list").replaceChildren(...(published.posts.length ? published.posts.map(item => renderReview(item, true)) : [node("p", "暂无已发布的文章。", "desk-review-empty")]));
    el("blog-archived-list").replaceChildren(...(inactive.drafts.length ? inactive.drafts.map(item => renderReview(item, false, undefined, true)) : [node("p", "暂无测试或已归档的稿件。", "desk-review-empty")]));
    reviewMessage(message || `${drafts.drafts.filter(item => item.status !== "rejected").length} 篇待审核，${published.total ?? published.posts.length} 篇已发布。`);
    if (published.total > published.posts.length) el("blog-published-list").append(node("p", `此处显示最近 ${published.posts.length} 篇已发布文章。`, "desk-review-empty"));
  } catch (error) {
    if (current === generation && version === reviewVersion && !(error instanceof SessionExpired)) reviewMessage(`博客审核暂时无法读取。${reviewError(error)} 可点击“重新读取”重试。`, true);
  } finally {
    if (current === generation && version === reviewVersion) for (const id of ["blog-drafts-list", "blog-published-list", "blog-archived-list"]) el(id).setAttribute("aria-busy", "false");
  }
}
async function reviewAction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-review-action]");
  const row = button?.closest<HTMLElement>("[data-slug]");
  if (!active || !button || !row || button.disabled) return;
  const action = button.dataset.reviewAction;
  if (!action || !["publish", "reject", "unpublish", "archive", "restore", "metadata"].includes(action)) return;
  const title = row.querySelector("h3")?.textContent ?? "这篇文章";
  const confirmations: Record<string, string> = {
    unpublish: `下架《${title}》？公开页面将无法访问。`,
    publish: `发布《${title}》的修订 ${row.dataset.revision}？文章及图片将公开可见。`,
    archive: `归档《${title}》？归档后不再出现在审核队列，可随时恢复。`,
  };
  if (confirmations[action] && !window.confirm(confirmations[action])) return;
  const current = generation;
  const buttons = row.querySelectorAll<HTMLButtonElement>("button");
  for (const control of buttons) control.disabled = true;
  row.setAttribute("aria-busy", "true");
  reviewMessage(action === "publish" ? "正在发布…" : action === "reject" ? "正在拒绝草稿…" : action === "unpublish" ? "正在下架…" : action === "archive" ? "正在归档…" : action === "restore" ? "正在恢复…" : "正在保存分类与标签…");
  try {
    const slug = encodeURIComponent(row.dataset.slug!);
    const revision = Number(row.dataset.revision);
    const note = row.querySelector<HTMLTextAreaElement>("textarea")?.value.trim();
    let endpoint = action === "unpublish" ? `/api/blog/posts/${slug}/unpublish` : `/api/blog/drafts/${slug}/${action}`;
    let payload: Record<string, unknown> = action === "reject" ? { revision, note: note || undefined } : { revision };
    if (action === "metadata") {
      const category = row.querySelector<HTMLSelectElement>("select[name=category]")?.value ?? "";
      const tags = (row.querySelector<HTMLInputElement>("input[name=tags]")?.value ?? "").split(/[,，]/).map(value => value.trim()).filter(Boolean);
      const series = row.querySelector<HTMLInputElement>("input[name=series]")?.value.trim() ?? "";
      if (!tags.length || tags.length > 5) throw Error("请填写 1–5 个标签，用逗号分隔。");
      endpoint = `/api/blog/drafts/${slug}/metadata`;
      payload = { revision, category: category || null, tags, series: series || null };
    }
    await api(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (current !== generation || !active) return;
    await loadReview(action === "publish" ? "文章已发布。" : action === "reject" ? "草稿已拒绝，审阅说明已保存。" : action === "unpublish" ? "文章已下架。" : action === "archive" ? "稿件已归档，可在下方恢复。" : action === "restore" ? "稿件已恢复到审核队列。" : "分类与标签已保存。");
  } catch (error) {
    if (current === generation && active && !(error instanceof SessionExpired)) reviewMessage(`${reviewError(error)} 可点击“重新读取”获取最新状态。`, true);
  } finally {
    if (current === generation && active) {
      row.setAttribute("aria-busy", "false");
      for (const control of buttons) control.disabled = false;
    }
  }
}
function renderCategories() {
  const list = el("blog-categories-list");
  list.replaceChildren(...categoriesCache.map(category => {
    const row = node("p", "", "desk-category-row");
    row.append(node("span", `${category.name}（${category.slug}）· ${category.published} 篇已发布`));
    const remove = node("button", "删除", "desk-text-button");
    remove.type = "button";
    remove.dataset.categoryDelete = category.slug;
    row.append(remove);
    return row;
  }));
}
async function categoryAction(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("[data-category-delete]");
  if (!active || !button || button.disabled) return;
  const slug = button.dataset.categoryDelete!;
  if (!window.confirm(`删除分类 ${slug}？只有没有稿件使用的分类才能删除。`)) return;
  button.disabled = true;
  try {
    await api(`/api/blog/categories/${encodeURIComponent(slug)}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await loadReview("分类已删除。");
  } catch (error) {
    if (!(error instanceof SessionExpired)) reviewMessage(reviewError(error), true);
  } finally { button.disabled = false; }
}
el("blog-categories-list").addEventListener("click", categoryAction);
el<HTMLFormElement>("blog-category-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!active) return;
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const button = form.querySelector<HTMLButtonElement>("button")!;
  button.disabled = true;
  try {
    await api("/api/blog/categories", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: String(data.get("slug") ?? "").trim(), name: String(data.get("name") ?? "").trim() }) });
    form.reset();
    await loadReview("分类已添加。");
  } catch (error) {
    if (!(error instanceof SessionExpired)) reviewMessage(reviewError(error), true);
  } finally { button.disabled = false; }
});
el("blog-review-status").setAttribute("aria-live", "polite");
const reviewRetry = node("button", "重新读取", "desk-text-button");
reviewRetry.type = "button";
reviewRetry.addEventListener("click", () => { void loadReview(); });
el("blog-review-status").after(reviewRetry);
el("blog-drafts-list").addEventListener("click", reviewAction);
el("blog-published-list").addEventListener("click", reviewAction);
el("blog-archived-list").addEventListener("click", reviewAction);

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
      ? `${data.source === "wechat" ? "查询" : data.source === "gu" ? "批次" : "记录"}：${time(data.asOf)}` : "";
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
      section.append(node("p", `${data.source === "wechat" ? "查询时间" : "数据日期"}：${time(data.asOf)}`, "desk-fine"));
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
