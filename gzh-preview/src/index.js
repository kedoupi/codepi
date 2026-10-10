import { mergeBoard, normalizeArticle, parseReviewBody, reviewKey } from "./board.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    try {
      if (url.pathname === "/api/board" && request.method === "GET") {
        return json(await getBoard(request, env));
      }
      if (url.pathname === "/api/review" && request.method === "POST") {
        return handleReview(request, env);
      }
      return json({ error: "未找到接口" }, 404);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "api_failed", err: String(err) }));
      return json({ error: "服务暂时不可用" }, 500);
    }
  },
};

async function getBoard(request, env) {
  const staticBoard = await loadStaticBoard(request, env);
  const reviews = await loadReviews(env, staticBoard);
  return mergeBoard(staticBoard, reviews);
}

async function handleReview(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON 无法解析" }, 400);
  }

  const staticBoard = await loadStaticBoard(request, env);
  const knownIds = new Set(
    (staticBoard.articles || []).map(normalizeArticle).filter(Boolean).map((a) => a.id),
  );
  const parsed = parseReviewBody(body, knownIds);
  if (parsed.error) return json({ error: parsed.error }, 400);

  await env.BOARD_KV.put(reviewKey(parsed.review.id), JSON.stringify(parsed.review));
  const board = await getBoard(request, env);
  const article = board.articles.find((item) => item.id === parsed.review.id);
  return json({ ok: true, article, board });
}

async function loadStaticBoard(request, env) {
  const assetReq = new Request(new URL("/board.json", request.url), {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const res = await env.ASSETS.fetch(assetReq);
  if (!res.ok) {
    throw new Error(`board.json ${res.status}`);
  }
  return res.json();
}

async function loadReviews(env, staticBoard) {
  const ids = (staticBoard.articles || [])
    .map(normalizeArticle)
    .filter(Boolean)
    .map((article) => article.id);
  const reviews = new Map();
  if (!ids.length) return reviews;

  const values = await env.BOARD_KV.get(ids.map(reviewKey), "json");
  for (const id of ids) {
    const overlay = values.get(reviewKey(id));
    if (overlay) reviews.set(id, overlay);
  }
  return reviews;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
