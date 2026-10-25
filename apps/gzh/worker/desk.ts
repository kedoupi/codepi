import { bodyJson, brandName, isDateOnly, isSlug, isSlot, json, nowIso, shanghaiDate } from "./lib";
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
  "id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, created_at, updated_at";

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
}

function lastReview(
  reviews: Map<string, { action: ReviewAction; note: string | null; created_at: string }>,
  postId: string,
) {
  return reviews.get(postId) ?? null;
}

async function toBoardPost(
  env: Env,
  row: PostRow,
  reviews?: Map<string, { action: ReviewAction; note: string | null; created_at: string }>,
): Promise<BoardPost> {
  return {
    slug: row.id,
    title: row.title,
    slot: row.slot,
    publish_date: row.publish_date,
    status: row.status,
    preview_path: row.preview_path,
    note: row.note,
    digest: row.digest,
    last_review: reviews ? lastReview(reviews, row.id) : ((await env.DB.prepare(
      `SELECT action, note, created_at FROM reviews WHERE post_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(row.id).first<{ action: ReviewAction; note: string | null; created_at: string }>()) ?? null),
    is_demo: demoFlag(row),
    can_withdraw: canWithdraw(row.status),
  };
}

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

  const pending = (
    await env.DB.prepare(
      `SELECT ${POST_COLUMNS} FROM posts
       WHERE status = '待审'
       ORDER BY publish_date ASC,
         CASE slot WHEN '早' THEN 1 WHEN '中' THEN 2 WHEN '晚' THEN 3 ELSE 4 END`,
    ).all<PostRow>()
  ).results;

  const reviewRows = (
    await env.DB.prepare(
      `SELECT post_id, action, note, created_at
       FROM reviews
       WHERE post_id IN (
         SELECT id FROM posts WHERE publish_date = ? OR status = '待审'
       )
       ORDER BY created_at DESC`,
    )
      .bind(date)
      .all<{ post_id: string; action: ReviewAction; note: string | null; created_at: string }>()
  ).results;
  const reviews = new Map<string, { action: ReviewAction; note: string | null; created_at: string }>();
  for (const review of reviewRows) {
    if (!reviews.has(review.post_id)) {
      reviews.set(review.post_id, {
        action: review.action,
        note: review.note,
        created_at: review.created_at,
      });
    }
  }

  const slots = [];
  for (const slot of SLOTS) {
    const row = bySlot.get(slot);
    slots.push({
      slot,
      post: row ? await toBoardPost(env, row, reviews) : null,
    });
  }

  const queue = [];
  for (const row of pending) {
    queue.push(await toBoardPost(env, row, reviews));
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
  return json({ ok: true, post: await toBoardPost(env, row), brand: brandName(env) });
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
    body = (await bodyJson(request)) as UpsertBody;
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
  const lookupSlug = fromSlug || requestedSlug;
  const persistSlug = newSlug || requestedSlug;

  if (!isSlug(lookupSlug) || !isSlug(persistSlug) || !title || !isDateOnly(publishDate) || !isSlot(slot)) {
    return json({ ok: false, error: "请填写 slug、标题、日期和档位" }, 400);
  }
  if (submit && !previewPath) {
    return json({ ok: false, error: "待审需要预览地址" }, 400);
  }

  const existing = await loadPost(env, lookupSlug);

  if (persistSlug !== lookupSlug) {
    const renameError = await checkPostIdAvailable(env, persistSlug);
    if (renameError) return json({ ok: false, error: renameError.error }, renameError.status);
  }

  const occupant = await env.DB.prepare(
    `SELECT ${POST_COLUMNS} FROM posts WHERE publish_date = ? AND slot = ? AND id != ?`,
  )
    .bind(publishDate, slot, lookupSlug)
    .first<PostRow>();
  if (occupant && !demoFlag(occupant)) {
    return json({ ok: false, error: "该日期档位已有稿件" }, 409);
  }

  if (existing && !canEditCopy(existing.status)) {
    return json({ ok: false, error: "已进箱的稿不能改" }, 409);
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

  const preview = previewPath || existing?.preview_path || `/p/${persistSlug}/`;
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
  const sourceReady = existing
    ? `EXISTS (SELECT 1 FROM posts WHERE id = ? AND status = ? AND updated_at = ?)`
    : "";
  const statements: D1PreparedStatement[] = [];

  if (occupant) {
    statements.push(
      env.DB.prepare(
        `UPDATE posts SET slot = NULL WHERE id = ? AND is_demo = 1${existing ? ` AND ${sourceReady}` : ""}`,
      ).bind(occupant.id, ...(existing ? [existing.id, existing.status, existing.updated_at] : [])),
    );
  }

  if (existing) {
    statements.push(
      env.DB.prepare(
        `UPDATE posts
         SET title = ?, slot = ?, publish_date = ?, status = ?, preview_path = ?, note = ?, digest = ?, is_demo = ?, updated_at = ?
         WHERE id = ? AND status = ? AND updated_at = ?`,
      ).bind(
        title,
        persistSlug === existing.id ? slot : null,
        publishDate,
        nextStatus,
        preview,
        note || null,
        digest || existing.digest,
        nextDemo,
        stamp,
        existing.id,
        existing.status,
        existing.updated_at,
      ),
    );
    if (persistSlug !== existing.id) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, created_at, updated_at)
           VALUES (?, (SELECT account_id FROM posts WHERE id = ? AND status = ? AND updated_at = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          persistSlug,
          existing.id,
          nextStatus,
          stamp,
          title,
          slot,
          publishDate,
          nextStatus,
          preview,
          note || null,
          digest || existing.digest,
          nextDemo,
          existing.created_at,
          stamp,
        ),
        env.DB.prepare(`UPDATE reviews SET post_id = ? WHERE post_id = ?`).bind(persistSlug, existing.id),
        env.DB.prepare(`DELETE FROM posts WHERE id = ? AND status = ? AND updated_at = ?`).bind(
          existing.id,
          nextStatus,
          stamp,
        ),
      );
    }
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(
        persistSlug,
        account.id,
        title,
        slot,
        publishDate,
        nextStatus,
        preview,
        note || null,
        digest || null,
        stamp,
        stamp,
      ),
    );
  }

  if (occupant) {
    const persistedId = persistSlug;
    statements.push(
      env.DB.prepare(`DELETE FROM reviews WHERE post_id = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ?)`).bind(
        occupant.id,
        persistedId,
      ),
      env.DB.prepare(`DELETE FROM posts WHERE id = ? AND is_demo = 1 AND slot IS NULL`).bind(occupant.id),
      env.DB.prepare(`INSERT OR REPLACE INTO desk_meta (key, value, updated_at) VALUES (?, 'released', ?)`).bind(
        `skip_auto_demo:${publishDate}`,
        stamp,
      ),
    );
  }
  const results = await env.DB.batch(statements);
  if (existing && results[occupant ? 1 : 0]?.meta.changes !== 1) {
    return json({ ok: false, error: "当前状态不能再交待审" }, 409);
  }

  const row = await loadPost(env, persistSlug);
  return json({ ok: true, post: row ? await toBoardPost(env, row) : null });
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
    body = (await bodyJson(request)) as PatchBody;
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

  if (persistSlug !== post.id) {
    const renameError = await checkPostIdAvailable(env, persistSlug);
    if (renameError) return json({ ok: false, error: renameError.error }, renameError.status);
  }

  const stamp = nowIso();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE posts
       SET title = ?, slot = ?, preview_path = ?, note = ?, digest = ?, is_demo = ?, updated_at = ?
       WHERE id = ? AND status = ? AND updated_at = ?`,
    ).bind(
      nextTitle,
      persistSlug === post.id ? post.slot : null,
      nextPreview,
      nextNote,
      nextDigest,
      nextDemo,
      stamp,
      post.id,
      post.status,
      post.updated_at,
    ),
  ];
  if (persistSlug !== post.id) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, created_at, updated_at)
         VALUES (?, (SELECT account_id FROM posts WHERE id = ? AND status = ? AND updated_at = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        persistSlug,
        post.id,
        post.status,
        stamp,
        nextTitle,
        post.slot,
        post.publish_date,
        post.status,
        nextPreview,
        nextNote,
        nextDigest,
        nextDemo,
        post.created_at,
        stamp,
      ),
      env.DB.prepare(`UPDATE reviews SET post_id = ? WHERE post_id = ?`).bind(persistSlug, post.id),
      env.DB.prepare(`DELETE FROM posts WHERE id = ? AND status = ? AND updated_at = ?`).bind(
        post.id,
        post.status,
        stamp,
      ),
    );
  }
  const results = await env.DB.batch(statements);
  if (results[0].meta.changes !== 1) {
    return json({ ok: false, error: "稿件不存在" }, 404);
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
    body = (await bodyJson(request)) as ReviewBody;
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

  const [, transition] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reviews (id, post_id, actor_account_id, action, from_status, to_status, note, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND status = ?)`,
    ).bind(
      crypto.randomUUID(),
      slug,
      account.id,
      typedAction,
      post.status,
      toStatus,
      reviewNote,
      stamp,
      slug,
      post.status,
    ),
    env.DB.prepare(
      `UPDATE posts SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status = ?`,
    ).bind(toStatus, reviewNote ?? post.note, stamp, slug, post.status),
  ]);
  if (transition.meta.changes !== 1) {
    return json({ ok: false, error: "只有待审稿可以审" }, 409);
  }

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

  const result = await env.DB.prepare(
    `UPDATE posts SET status = '已进箱', updated_at = ? WHERE id = ? AND status = ?`,
  )
    .bind(nowIso(), slug, post.status)
    .run();
  if (result.meta.changes !== 1) {
    return json({ ok: false, error: "只有可推箱才能标已进箱" }, 409);
  }

  const row = await loadPost(env, slug);

  return json({ ok: true, post: row ? await toBoardPost(env, row) : null });
}

async function loadPost(env: Env, slug: string): Promise<PostRow | null> {
  return env.DB.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`).bind(slug).first<PostRow>();
}

async function checkPostIdAvailable(
  env: Env,
  slug: string,
): Promise<{ error?: string; status: number } | null> {
  if (!isSlug(slug)) return { error: "slug 无效", status: 400 };
  const clash = await env.DB.prepare(`SELECT id FROM posts WHERE id = ?`).bind(slug).first<{ id: string }>();
  return clash ? { error: "slug 已被占用", status: 409 } : null;
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

  const result = await env.DB.prepare(
    `UPDATE posts SET status = '待审', note = ?, updated_at = ? WHERE id = ? AND status = ?`,
  )
    .bind(note, stamp, slug, post.status)
    .run();
  if (result.meta.changes !== 1) {
    return json({ ok: false, error: "只有需改、可推箱或已进箱可以撤回待审" }, 409);
  }

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
