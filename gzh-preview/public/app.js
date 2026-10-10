const FILTERS = ["待审", "需改", "可推箱", "已进箱", "早", "中", "晚", "全部"];
const DEFAULT_FILTER = "待审";
const PREVIEW_HOST = "https://gzh-preview.pages.dev";

export function coverUrl(article) {
  return `${PREVIEW_HOST}/${article.id}/cover.png`;
}

export function previewUrl(article) {
  return `${PREVIEW_HOST}/${article.id}/`;
}

export function qrImgUrl(url, size = 72) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(url)}`;
}

export function matchesFilter(article, filter) {
  if (filter === "全部") return true;
  if (filter === "早" || filter === "中" || filter === "晚") return article.slot === filter;
  return article.status === filter;
}

export function statusClass(status) {
  return `st st-${status}`;
}

export async function loadBoard() {
  const res = await fetch("/api/board", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`board ${res.status}`);
  return res.json();
}

export async function postReview(payload) {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `review ${res.status}`);
  return data;
}

export function renderHome(root, board, filter = DEFAULT_FILTER) {
  const articles = board.articles || [];
  const visible = articles.filter((item) => matchesFilter(item, filter));
  root.innerHTML = `
    <div class="wb">
      <div class="wb-head">
        <div>
          <h1>公号预览工作台</h1>
          <div class="sub">仿微信阅读页 · 过审后再推草稿箱 · 更新 ${board.updated || ""}</div>
        </div>
        <div class="pills" role="tablist" aria-label="队列筛选">
          ${FILTERS.map((name) => `<button type="button" class="pill${name === filter ? " active" : ""}" data-filter="${name}">${name}</button>`).join("")}
        </div>
      </div>
      <div class="grid">
        ${visible.length ? visible.map(cardHtml).join("") : `<div class="empty">这个队列是空的</div>`}
      </div>
    </div>
  `;
}

function cardHtml(article) {
  const slot = article.slot ? `<span class="slot">${article.slot}</span>` : "";
  const note = article.note ? `<div class="cd">${escapeHtml(article.note)}</div>` : article.digest ? `<div class="cd">${escapeHtml(article.digest)}</div>` : `<div class="cd"></div>`;
  return `
    <article class="card" data-id="${escapeHtml(article.id)}" data-slot="${escapeHtml(article.slot || "")}" data-status="${escapeHtml(article.status)}">
      <img src="${coverUrl(article)}" alt="" />
      <div class="card-main">
        <div>${slot}<span class="${statusClass(article.status)}">${escapeHtml(article.status)}</span></div>
        <div class="ct">${escapeHtml(article.title)}</div>
        ${note}
        <div class="ops">
          <a href="/article.html?id=${encodeURIComponent(article.id)}">打开预览</a>
          <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">原链</a>
        </div>
      </div>
      <img class="qr-mini" alt="扫码打开 ${escapeHtml(article.title)}" src="${qrImgUrl(article.url, 72)}" />
    </article>
  `;
}

export function bindHome(root, board) {
  let filter = DEFAULT_FILTER;
  const paint = () => {
    renderHome(root, board, filter);
    root.querySelectorAll(".pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        paint();
      });
    });
  };
  paint();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
