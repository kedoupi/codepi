export const STATUSES = ["待审", "需改", "可推箱", "已进箱"];
export const SLOTS = ["早", "中", "晚"];
export const REVIEW_KEY_PREFIX = "review:";

const ACTION_STATUS = {
  过: "可推箱",
  pass: "可推箱",
  要改: "需改",
  拒: "需改",
  change: "需改",
  reject: "需改",
};

export function reviewKey(id) {
  return `${REVIEW_KEY_PREFIX}${id}`;
}

export function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const slot = SLOTS.includes(raw.slot) ? raw.slot : "";
  const status = STATUSES.includes(raw.status) ? raw.status : "待审";
  return {
    id,
    slot,
    title: String(raw.title || id),
    url: String(raw.url || ""),
    status,
    note: raw.note == null ? "" : String(raw.note),
    digest: raw.digest == null ? "" : String(raw.digest),
  };
}

export function mergeBoard(staticBoard, reviews) {
  const articles = Array.isArray(staticBoard?.articles)
    ? staticBoard.articles.map(normalizeArticle).filter(Boolean)
    : [];
  const byId = reviews instanceof Map ? reviews : new Map(Object.entries(reviews || {}));

  return {
    updated: staticBoard?.updated || "",
    base: staticBoard?.base || "https://gzh-preview.kdp.cool",
    articles: articles.map((article) => {
      const overlay = byId.get(article.id);
      if (!overlay || typeof overlay !== "object") return article;
      return {
        ...article,
        status: STATUSES.includes(overlay.status) ? overlay.status : article.status,
        note: overlay.note == null ? article.note : String(overlay.note),
      };
    }),
  };
}

export function parseReviewBody(body, knownIds) {
  if (!body || typeof body !== "object") {
    return { error: "请求体必须是 JSON 对象" };
  }
  const id = String(body.id || "").trim();
  if (!id) return { error: "缺少 id" };
  if (knownIds && !knownIds.has(id)) return { error: "文章不在 board 中" };

  let status = "";
  if (body.action != null && String(body.action)) {
    status = ACTION_STATUS[String(body.action)];
    if (!status) return { error: "action 仅支持 过 / 要改 / 拒" };
  } else if (body.status != null) {
    status = String(body.status);
    if (!STATUSES.includes(status)) {
      return { error: "status 仅支持 待审 / 需改 / 可推箱 / 已进箱" };
    }
  } else {
    return { error: "需要 action 或 status" };
  }

  const note = body.note == null ? "" : String(body.note).slice(0, 500);
  return {
    review: {
      id,
      status,
      note,
      updatedAt: new Date().toISOString(),
    },
  };
}
