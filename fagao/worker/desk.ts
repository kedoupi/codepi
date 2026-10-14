import { brandName, isDateOnly, isSlug, isSlot, json, nowIso, shanghaiDate } from "./lib";
import { MAX_HTML_CHARS, checkCover, contentPath, reviewPath } from "./content";
import { ensureTodayDemo, markSkipAutoDemo, shouldClearDemo } from "./seed";
import {
  canEditCopy,
  canEditRole,
  canMarkBoxed,
  canReview,
  canReviewRole,
  canSubmit,
  canWithdraw,
  reviewNextStatus,
} from "./status";
import { REVIEW_ACTIONS, SLOTS, type AuthedAccount, type PostRow, type ReviewAction, type Slot } from "./types";

const POST_COLUMNS =
  "id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, cover, (html IS NOT NULL) AS has_html, current_version, created_at, updated_at";

function demoFlag(row: { is_demo: number }): boolean {
  return Number(row.is_demo) === 1;
}

interface BoardPost {
  slug: string;
  title: string;
  slot: Slot | null;
  publish_date: string;
  status: PostRow["status"];
  preview_path: string | null;
  note: string | null;
  digest: string | null;
  last_review: {
    action: ReviewAction;
    note: string | null;
    created_at: string;
  } | null;
  is_demo: boolean;
  can_withdraw: boolean;
  has_html: boolean;
  has_cover: boolean;
  review_path: string;
  version: number;
}

async function lastReview(env: Env, postId: string) {
  return env.DB.prepare(
    `SELECT action, note, created_at FROM reviews WHERE post_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(postId)
    .first<{ action: ReviewAction; note: string | null; created_at: string }>();
}

async function toBoardPost(env: Env, row: PostRow): Promise<BoardPost> {
  return {
    slug: row.id,
    title: row.title,
    slot: row.slot,
    publish_date: row.publish_date,
    status: row.status,
    preview_path: row.preview_path,
    note: row.note,
    digest: row.digest,
    last_review: (await lastReview(env, row.id)) ?? null,
    is_demo: demoFlag(row),
    can_withdraw: canWithdraw(row.status),
    has_html: Number(row.has_html) === 1,
    has_cover: !!row.cover,
    review_path: reviewPath(row.id),
    version: Number(row.current_version ?? 0),
  };
}

async function versionHistory(env: Env, postId: string) {
  const versions = (
    await env.DB.prepare(
      `SELECT version, title, created_at FROM post_versions WHERE post_id = ? ORDER BY version DESC`,
    )
      .bind(postId)
      .all<{ version: number; title: string; created_at: string }>()
  ).results;
  const reviews = (
    await env.DB.prepare(
      `SELECT version, action, note, created_at FROM reviews WHERE post_id = ? ORDER BY created_at ASC`,
    )
      .bind(postId)
      .all<{ version: number | null; action: ReviewAction; note: string | null; created_at: string }>()
  ).results;
  return versions.map((v) => ({
    ...v,
    reviews: reviews
      .filter((r) => r.version === v.version)
      .map(({ action, note, created_at }) => ({ action, note, created_at })),
  }));
}

/** 交审时给当前内容拍快照，版本号 +1。 */
async function snapshotVersion(env: Env, postId: string, accountId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT current_version FROM posts WHERE id = ?`)
    .bind(postId)
    .first<{ current_version: number }>();
  const next = Number(row?.current_version ?? 0) + 1;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO post_versions (id, post_id, version, title, digest, preview_path, html, cover, account_id, created_at)
       SELECT ?, id, ?, title, digest, preview_path, html, cover, ?, ? FROM posts WHERE id = ?`,
    ).bind(crypto.randomUUID(), next, accountId, nowIso(), postId),
    env.DB.prepare(`UPDATE posts SET current_version = ? WHERE id = ?`).bind(next, postId),
  ]);
  return next;
}

const IN_REVIEW_LOCKED = "在审版本不能覆盖：等老板审完（要改后再交即生成新版本），或先撤回";

export async function handleBoard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const today = shanghaiDate();
  const date = url.searchParams.get("date") || today;
  if (!isDateOnly(date)) {
    return json({ ok: false, error: "日期无效" }, 400);
  }

  if (date === today) {
    await ensureTodayDemo(env, date);
  }

  const rows = (
    await env.DB.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE publish_date = ?`)
      .bind(date)
      .all<PostRow>()
  ).results;

  const bySlot = new Map<string, PostRow>();
  for (const row of rows) {
    if (row.slot) bySlot.set(row.slot, row);
  }

  const slots = [];
  for (const slot of SLOTS) {
    const row = bySlot.get(slot);
    slots.push({
      slot,
      post: row ? await toBoardPost(env, row) : null,
    });
  }

  const pending = (
    await env.DB.prepare(
      `SELECT ${POST_COLUMNS} FROM posts
       WHERE status = '待审'
       ORDER BY publish_date ASC,
         CASE slot WHEN '早' THEN 1 WHEN '中' THEN 2 WHEN '晚' THEN 3 ELSE 4 END`,
    ).all<PostRow>()
  ).results;

  const queue = [];
  for (const row of pending) {
    queue.push(await toBoardPost(env, row));
  }

  return json({
    ok: true,
    date,
    today,
    brand: brandName(env),
    slots,
    queue,
  });
}

export async function handleGetPost(env: Env, slug: string): Promise<Response> {
  if (!isSlug(slug)) return json({ ok: false, error: "稿件不存在" }, 404);
  const row = await env.DB.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`)
    .bind(slug)
    .first<PostRow>();
  if (!row) return json({ ok: false, error: "稿件不存在" }, 404);
  return json({
    ok: true,
    post: await toBoardPost(env, row),
    versions: await versionHistory(env, row.id),
    brand: brandName(env),
  });
}

interface UpsertBody {
  slug?: unknown;
  from_slug?: unknown;
  new_slug?: unknown;
  title?: unknown;
  slot?: unknown;
  publish_date?: unknown;
  preview_path?: unknown;
  note?: unknown;
  digest?: unknown;
  submit?: unknown;
  mark_official?: unknown;
  html?: unknown;
  cover?: unknown;
}

export async function handleUpsertPost(
  request: Request,
  env: Env,
  account: AuthedAccount,
): Promise<Response> {
  if (!canEditRole(account.role)) {
    return json({ ok: false, error: "没有编辑权限" }, 403);
  }

  let body: UpsertBody;
  try {
    body = (await request.json()) as UpsertBody;
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }

  const requestedSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  const fromSlug =
    typeof body.from_slug === "string" && body.from_slug.trim()
      ? body.from_slug.trim()
      : requestedSlug;
  const newSlug =
    typeof body.new_slug === "string" && body.new_slug.trim()
      ? body.new_slug.trim()
      : requestedSlug !== fromSlug
        ? requestedSlug
        : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const publishDate = typeof body.publish_date === "string" ? body.publish_date.trim() : "";
  const previewPath =
    typeof body.preview_path === "string" ? body.preview_path.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const digest = typeof body.digest === "string" ? body.digest.trim() : "";
  const submit = body.submit === true;
  const markOfficial = body.mark_official === true;
  const slot = body.slot;
  const html = typeof body.html === "string" && body.html.trim() ? body.html : null;
  if (body.html !== undefined && body.html !== null && typeof body.html !== "string") {
    return json({ ok: false, error: "html 必须是字符串" }, 400);
  }
  if (html && html.length > MAX_HTML_CHARS) {
    return json({ ok: false, error: "正文太大（上限约 1MB）" }, 413);
  }
  const coverCheck = checkCover(body.cover);
  if (!coverCheck.ok) return json({ ok: false, error: coverCheck.error }, 400);
  const lookupSlug = fromSlug || requestedSlug;
  const persistSlug = newSlug || requestedSlug;

  if (!isSlug(lookupSlug) || !isSlug(persistSlug) || !title || !isDateOnly(publishDate) || !isSlot(slot)) {
    return json({ ok: false, error: "请填写 slug、标题、日期和档位" }, 400);
  }
  const existing = await loadPost(env, lookupSlug);
  const keepsHtml = !html && !!existing && Number(existing.has_html) === 1 && !previewPath;
  if (submit && !previewPath && !html && !keepsHtml) {
    return json({ ok: false, error: "待审需要预览地址或正文 html" }, 400);
  }

  const occupant = await env.DB.prepare(
    `SELECT ${POST_COLUMNS} FROM posts WHERE publish_date = ? AND slot = ? AND id != ?`,
  )
    .bind(publishDate, slot, lookupSlug)
    .first<PostRow>();
  if (occupant) {
    if (!demoFlag(occupant)) {
      return json({ ok: false, error: "该日期档位已有稿件" }, 409);
    }
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM reviews WHERE post_id = ?`).bind(occupant.id),
      env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(occupant.id),
    ]);
    await markSkipAutoDemo(env, publishDate);
  }

  if (existing && !canEditCopy(existing.status)) {
    return json({ ok: false, error: "已进箱的稿不能改" }, 409);
  }
  if (existing && existing.status === "待审" && !demoFlag(existing)) {
    return json({ ok: false, error: IN_REVIEW_LOCKED, version: Number(existing.current_version ?? 0) }, 409);
  }

  const nextStatus = submit
    ? "待审"
    : existing
      ? existing.status === "待审"
        ? "待审"
        : existing.status
      : "draft";

  if (submit && existing && !canSubmit(existing.status) && existing.status !== "待审") {
    return json({ ok: false, error: "当前状态不能再交待审" }, 409);
  }

  const preview = html || keepsHtml
    ? previewPath || contentPath(persistSlug)
    : previewPath || existing?.preview_path || `/p/${persistSlug}/`;
  const stamp = nowIso();
  const nextDemo =
    existing &&
    demoFlag(existing) &&
    !shouldClearDemo({
      isDemo: true,
      title,
      previewPath: preview,
      markOfficial,
      nextSlug: persistSlug,
    })
      ? 1
      : 0;

  if (existing) {
    await env.DB.prepare(
      `UPDATE posts
       SET title = ?, slot = ?, publish_date = ?, status = ?, preview_path = ?, note = ?, digest = ?, is_demo = ?, updated_at = ?,
           html = COALESCE(?, html), cover = COALESCE(?, cover)
       WHERE id = ?`,
    )
      .bind(
        title,
        slot,
        publishDate,
        nextStatus,
        preview,
        note || null,
        digest || existing.digest,
        nextDemo,
        stamp,
        html,
        coverCheck.value,
        existing.id,
      )
      .run();
    if (persistSlug !== existing.id) {
      const renamed = await renamePostId(env, existing.id, persistSlug);
      if (renamed.error) return json({ ok: false, error: renamed.error }, renamed.status);
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, html, cover, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
      .bind(
        persistSlug,
        account.id,
        title,
        slot,
        publishDate,
        nextStatus,
        preview,
        note || null,
        digest || null,
        html,
        coverCheck.value,
        stamp,
        stamp,
      )
      .run();
  }

  if (submit) {
    await snapshotVersion(env, persistSlug, account.id);
  }

  const row = await loadPost(env, persistSlug);
  return json({
    ok: true,
    post: row ? await toBoardPost(env, row) : null,
    review_url: new URL(reviewPath(persistSlug), request.url).toString(),
  });
}

interface PatchBody {
  title?: unknown;
  preview_path?: unknown;
  note?: unknown;
  digest?: unknown;
  new_slug?: unknown;
  mark_official?: unknown;
}

export async function handlePatchPost(
  request: Request,
  env: Env,
  account: AuthedAccount,
  slug: string,
): Promise<Response> {
  if (!canEditRole(account.role)) {
    return json({ ok: false, error: "没有编辑权限" }, 403);
  }
  if (!isSlug(slug)) return json({ ok: false, error: "稿件不存在" }, 404);

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }

  const post = await loadPost(env, slug);
  if (!post) return json({ ok: false, error: "稿件不存在" }, 404);

  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const previewPath =
    typeof body.preview_path === "string" ? body.preview_path.trim() : undefined;
  const note = typeof body.note === "string" ? body.note.trim() : undefined;
  const digest = typeof body.digest === "string" ? body.digest.trim() : undefined;
  const newSlug = typeof body.new_slug === "string" ? body.new_slug.trim() : "";
  const markOfficial = body.mark_official === true;
  const changingCopy =
    title !== undefined || previewPath !== undefined || note !== undefined || digest !== undefined;

  if (changingCopy && !canEditCopy(post.status)) {
    return json({ ok: false, error: "已进箱的稿不能改" }, 409);
  }
  if (changingCopy && post.status === "待审" && !demoFlag(post)) {
    return json({ ok: false, error: IN_REVIEW_LOCKED, version: Number(post.current_version ?? 0) }, 409);
  }
  if (newSlug && !isSlug(newSlug)) {
    return json({ ok: false, error: "slug 无效" }, 400);
  }
  if (!changingCopy && !markOfficial && !newSlug) {
    return json({ ok: false, error: "没有可更新的字段" }, 400);
  }

  const nextTitle = title || post.title;
  const nextPreview = previewPath !== undefined ? previewPath || null : post.preview_path;
  const nextNote = note !== undefined ? note || null : post.note;
  const nextDigest = digest !== undefined ? digest || null : post.digest;
  const persistSlug = newSlug || post.id;
  const nextDemo = shouldClearDemo({
    isDemo: demoFlag(post),
    title: nextTitle,
    previewPath: nextPreview,
    markOfficial,
    nextSlug: persistSlug,
  })
    ? 0
    : Number(post.is_demo) === 1
      ? 1
      : 0;

  await env.DB.prepare(
    `UPDATE posts
     SET title = ?, preview_path = ?, note = ?, digest = ?, is_demo = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(nextTitle, nextPreview, nextNote, nextDigest, nextDemo, nowIso(), post.id)
    .run();

  if (persistSlug !== post.id) {
    const renamed = await renamePostId(env, post.id, persistSlug);
    if (renamed.error) return json({ ok: false, error: renamed.error }, renamed.status);
  }

  const row = await loadPost(env, persistSlug);
  return json({ ok: true, post: row ? await toBoardPost(env, row) : null });
}

interface ReviewBody {
  slug?: unknown;
  action?: unknown;
  note?: unknown;
}

export async function handleReview(
  request: Request,
  env: Env,
  account: AuthedAccount,
): Promise<Response> {
  if (!canReviewRole(account.role)) {
    return json({ ok: false, error: "没有审核权限" }, 403);
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return json({ ok: false, error: "请求无效" }, 400);
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!isSlug(slug) || typeof action !== "string" || !(REVIEW_ACTIONS as readonly string[]).includes(action)) {
    return json({ ok: false, error: "审核参数无效" }, 400);
  }
  if (action === "要改" && !note) {
    return json({ ok: false, error: "要改请写一句原因" }, 400);
  }

  const post = await loadPost(env, slug);
  if (!post) return json({ ok: false, error: "稿件不存在" }, 404);
  if (!canReview(post.status)) {
    return json({ ok: false, error: "只有待审稿可以审" }, 409);
  }

  const typedAction = action as ReviewAction;
  const toStatus = reviewNextStatus(typedAction);
  const stamp = nowIso();
  const reviewNote = note || null;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE posts SET status = ?, note = ?, updated_at = ? WHERE id = ?`,
    ).bind(toStatus, reviewNote ?? post.note, stamp, slug),
    env.DB.prepare(
      `INSERT INTO reviews (id, post_id, actor_account_id, action, from_status, to_status, note, created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      slug,
      account.id,
      typedAction,
      post.status,
      toStatus,
      reviewNote,
      stamp,
      Number(post.current_version ?? 0),
    ),
  ]);

  const updated = await loadPost(env, slug);

  return json({ ok: true, post: updated ? await toBoardPost(env, updated) : null });
}

export async function handleBoxed(
  env: Env,
  account: AuthedAccount,
  slug: string,
): Promise<Response> {
  if (!canEditRole(account.role)) {
    return json({ ok: false, error: "没有编辑权限" }, 403);
  }
  if (!isSlug(slug)) return json({ ok: false, error: "稿件不存在" }, 404);

  const post = await env.DB.prepare(`SELECT id, status FROM posts WHERE id = ?`)
    .bind(slug)
    .first<{ id: string; status: PostRow["status"] }>();
  if (!post) return json({ ok: false, error: "稿件不存在" }, 404);
  if (!canMarkBoxed(post.status)) {
    return json({ ok: false, error: "只有可推箱才能标已进箱" }, 409);
  }

  await env.DB.prepare(`UPDATE posts SET status = '已进箱', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), slug)
    .run();

  const row = await loadPost(env, slug);

  return json({ ok: true, post: row ? await toBoardPost(env, row) : null });
}

async function loadPost(env: Env, slug: string): Promise<PostRow | null> {
  return env.DB.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`).bind(slug).first<PostRow>();
}

async function renamePostId(
  env: Env,
  from: string,
  to: string,
): Promise<{ error?: string; status: number }> {
  if (from === to) return { status: 200 };
  if (!isSlug(to)) return { error: "slug 无效", status: 400 };

  const source = await loadPost(env, from);
  if (!source) return { error: "稿件不存在", status: 404 };

  const clash = await env.DB.prepare(`SELECT id FROM posts WHERE id = ?`).bind(to).first<{ id: string }>();
  if (clash) return { error: "slug 已被占用", status: 409 };

  const stamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET slot = NULL WHERE id = ?`).bind(from),
    env.DB.prepare(
      `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, html, cover, current_version, created_at, updated_at)
       SELECT ?, account_id, title, ?, publish_date, status,
              CASE WHEN preview_path = ? THEN ? ELSE preview_path END,
              note, digest, is_demo, html, cover, current_version, created_at, ?
       FROM posts WHERE id = ?`,
    ).bind(to, source.slot, contentPath(from), contentPath(to), stamp, from),
    env.DB.prepare(`UPDATE reviews SET post_id = ? WHERE post_id = ?`).bind(to, from),
    env.DB.prepare(`UPDATE post_versions SET post_id = ? WHERE post_id = ?`).bind(to, from),
    env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(from),
  ]);
  return { status: 200 };
}

export async function handleWithdraw(
  env: Env,
  account: AuthedAccount,
  slug: string,
): Promise<Response> {
  if (!canEditRole(account.role)) {
    return json({ ok: false, error: "没有编辑权限" }, 403);
  }
  if (!isSlug(slug)) return json({ ok: false, error: "稿件不存在" }, 404);

  const post = await loadPost(env, slug);
  if (!post) return json({ ok: false, error: "稿件不存在" }, 404);
  if (!canWithdraw(post.status)) {
    return json({ ok: false, error: "只有需改、可推箱或已进箱可以撤回待审" }, 409);
  }
  if (!post.preview_path) {
    return json({ ok: false, error: "待审需要预览地址" }, 400);
  }

  const stamp = nowIso();
  const note =
    post.status === "需改" && post.note
      ? post.note
      : demoFlag(post)
        ? "演示稿已撤回待审，可再过或换真稿"
        : "编辑撤回待审";

  await env.DB.prepare(`UPDATE posts SET status = '待审', note = ?, updated_at = ? WHERE id = ?`)
    .bind(note, stamp, slug)
    .run();

  const row = await loadPost(env, slug);
  return json({ ok: true, post: row ? await toBoardPost(env, row) : null });
}

export async function handleReleaseDemo(
  env: Env,
  account: AuthedAccount,
  slug: string,
): Promise<Response> {
  if (!canEditRole(account.role)) {
    return json({ ok: false, error: "没有编辑权限" }, 403);
  }
  if (!isSlug(slug)) return json({ ok: false, error: "稿件不存在" }, 404);

  const post = await loadPost(env, slug);
  if (!post) return json({ ok: false, error: "稿件不存在" }, 404);
  if (!demoFlag(post)) {
    return json({ ok: false, error: "只有演示稿可以撤档" }, 409);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reviews WHERE post_id = ?`).bind(slug),
    env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(slug),
  ]);
  await markSkipAutoDemo(env, post.publish_date);

  return json({ ok: true, released: slug, publish_date: post.publish_date });
}
