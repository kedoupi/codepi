import "./styles.css";
import {
  board,
  getPost,
  logout,
  markBoxed,
  me,
  patchPost,
  releaseDemo,
  requestOtp,
  review,
  verifyOtp,
  shiftDate,
  todayShanghai,
  upsertPost,
  withdrawPost,
  discardPost,
  type Account,
  type BoardPost,
  type SlotRow,
} from "./api";
import { bindBrokenCovers, escapeHtml, formatZhDate, previewSrc, slotHint, statusChipClass, statusLabel, thumbHtml } from "./format";
import {
  canInlinePreview,
  fetchSameOriginHtml,
  prepareInlineArticle,
  sandboxedIframeMarkup,
} from "./preview-embed";
import {
  isReadComplete,
  pendingReviewActionsHtml,
  READ_GATE_SLACK_PX,
  reviewDockLockClass,
} from "./read-gate";

function requireApp(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) throw new Error("#app missing");
  return el;
}
const app = requireApp();

/* —— Toast + cross-reload flash —— */
function showToast(text: string, kind: "ok" | "err" | "info" = "info") {
  let host = document.querySelector<HTMLElement>(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", "status");
  el.textContent = text;
  host.append(el);
  window.setTimeout(() => el.classList.add("is-out"), 2400);
  window.setTimeout(() => el.remove(), 2800);
}

function flashToast(text: string, kind: "ok" | "err" | "info" = "ok") {
  try {
    sessionStorage.setItem("fagao-flash", JSON.stringify({ text, kind }));
  } catch {
    /* private mode */
  }
}

function drainFlash() {
  try {
    const raw = sessionStorage.getItem("fagao-flash");
    if (!raw) return;
    sessionStorage.removeItem("fagao-flash");
    const { text, kind } = JSON.parse(raw) as { text: string; kind: "ok" | "err" | "info" };
    showToast(text, kind);
  } catch {
    /* ignore */
  }
}

function errText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/* —— Two-tap confirm (replaces window.confirm) —— */
function bindTwoTap(button: HTMLButtonElement, confirmLabel: string, onConfirm: () => Promise<void>) {
  const original = button.textContent || "";
  let timer = 0;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.armed !== "1") {
      button.dataset.armed = "1";
      button.classList.add("is-armed");
      button.textContent = confirmLabel;
      timer = window.setTimeout(() => {
        button.dataset.armed = "";
        button.classList.remove("is-armed");
        button.textContent = original;
      }, 3000);
      return;
    }
    window.clearTimeout(timer);
    button.dataset.armed = "";
    button.classList.remove("is-armed");
    button.textContent = original;
    button.disabled = true;
    try {
      await onConfirm();
    } catch (error) {
      button.disabled = false;
      showToast(errText(error, "操作失败"), "err");
    }
  });
}

function route(): "login" | "desk" | "preview" {
  const path = location.pathname;
  if (path.startsWith("/login")) return "login";
  if (path.startsWith("/p/")) return "preview";
  return "desk";
}

function previewSlug(): string {
  const match = location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]{0,63})\/?$/);
  return match?.[1] ?? "";
}

function masthead(account: Account | null, extra = "") {
  const brand = escapeHtml(account?.brand || "珂抖屁");
  return `
    <header class="masthead wb-head">
      <div class="brand-block">
        <p class="brand-kicker">${brand}</p>
        <h1 class="brand">发稿台</h1>
        <p class="sub">今日三档 · 通读后审 · 过了才进箱${extra}</p>
      </div>
      ${
        account
          ? `<div class="mast-actions">
              <span class="who" title="${escapeHtml(account.email)}">${escapeHtml((account.email.split("@")[0] || account.email))}</span>
              <button class="ghost-link" type="button" data-action="logout">退出</button>
            </div>`
          : ""
      }
    </header>
  `;
}

async function renderLogin() {
  const account = await me();
  if (account) {
    location.replace("/");
    return;
  }

  app.innerHTML = `
    ${masthead(null)}
    <section class="login-hero">
      <h2 class="login-title">登录后开始今日发稿</h2>
      <p class="hint">内部工具 · 邮箱验证码 · 仅白名单</p>
    </section>
    <section class="sheet login-pad login-card">
      <form id="otp-form" class="login-form">
        <label for="email">工作邮箱</label>
        <input id="email" name="email" type="email" autocomplete="username" required value="kedoupi@gmail.com" placeholder="name@example.com" />
        <button type="button" id="send" class="btn-primary-block">发送验证码</button>
        <label for="code">6 位验证码</label>
        <div class="code-row">
          <input id="code" name="code" inputmode="numeric" pattern="\d{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" />
          <button class="btn-primary-block" type="submit" id="verify">登录</button>
        </div>
      </form>
      <p class="hint msg-line" id="msg" role="status"></p>
    </section>
  `;

  const msg = app.querySelector<HTMLParagraphElement>("#msg")!;
  const email = app.querySelector<HTMLInputElement>("#email")!;
  const code = app.querySelector<HTMLInputElement>("#code")!;
  const send = app.querySelector<HTMLButtonElement>("#send")!;
  let resendTimer = 0;

  const setMsg = (text: string, kind: "" | "is-ok" | "is-err" = "") => {
    msg.textContent = text;
    msg.className = `hint msg-line${kind ? ` ${kind}` : ""}`;
  };

  const startResendCooldown = (seconds = 60) => {
    send.disabled = true;
    let left = seconds;
    send.textContent = `重发 (${left})`;
    resendTimer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(resendTimer);
        send.disabled = false;
        send.textContent = "重新发送";
        return;
      }
      send.textContent = `重发 (${left})`;
    }, 1000);
  };

  const sendCode = async () => {
    setMsg("发送中…");
    send.disabled = true;
    try {
      const res = await requestOtp(email.value);
      setMsg(res.dev_otp ? `本地开发码：${res.dev_otp}（无 Resend 时写入日志）` : res.message, "is-ok");
      startResendCooldown();
      code.focus();
    } catch (error) {
      send.disabled = false;
      setMsg(errText(error, "发送失败"), "is-err");
    }
  };

  let verifying = false;
  const verify = async () => {
    if (verifying || code.value.replace(/\D/g, "").length !== 6) return;
    verifying = true;
    setMsg("校验中…");
    try {
      await verifyOtp(email.value, code.value);
      setMsg("登录成功，进入看板…", "is-ok");
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.replace(next.startsWith("/") ? next : "/");
    } catch (error) {
      verifying = false;
      setMsg(errText(error, "登录失败"), "is-err");
      code.select();
    }
  };

  send.addEventListener("click", sendCode);

  // Enter anywhere in the form = 登录（不再是重发验证码）
  app.querySelector<HTMLFormElement>("#otp-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    void verify();
  });

  // 输满 6 位自动登录；粘贴整段验证码也直接登
  code.addEventListener("input", () => {
    const digits = code.value.replace(/\D/g, "").slice(0, 6);
    if (code.value !== digits) code.value = digits;
    if (digits.length === 6) void verify();
  });
}

function demoChip(post: BoardPost | null): string {
  return post?.is_demo ? `<span class="demo-tag">演示</span>` : "";
}

function articleMeta(post: BoardPost): string {
  const slotChip = post.slot ? `<span class="slot-chip">${escapeHtml(post.slot)}</span>` : "";
  const dateBit = post.slot ? slotHint(post.slot) : post.publish_date;
  return `
    <p class="article-meta">
      ${slotChip}
      <span class="${statusChipClass(post.status)}">${statusLabel(post.status)}</span>
      ${demoChip(post)}
      <span>${escapeHtml(dateBit)}</span>
    </p>
  `;
}

function demoTools(post: BoardPost, date: string): string {
  if (!post.is_demo || !post.slot) return "";
  const editHere = post.status !== "需改" && post.status !== "draft" && post.status !== "已进箱";
  return `
    ${
      editHere
        ? `<details class="compose demo-swap">
      <summary>改这篇（标题 / 预览）</summary>
      ${composeForm(date, { slot: post.slot, post }, post)}
    </details>`
        : ""
    }
    <details class="compose demo-swap">
      <summary>换真稿（新 slug 替掉这条演示）</summary>
      ${composeForm(date, { slot: post.slot, post: null })}
    </details>
    <button class="text-btn" type="button" data-official="${post.slug}">标为正式稿</button>
    <button class="text-btn" type="button" data-release="${post.slug}">撤掉演示</button>
  `;
}

function slotCard(date: string, row: SlotRow): string {
  const post = row.post;
  if (!post) {
    return `
      <article class="article-row is-empty">
        <div class="article-main">
          <div class="article-copy">
            <p class="article-meta"><span class="slot-chip">${row.slot}</span><span>${slotHint(row.slot)}</span></p>
            <h2 class="empty-title">${row.slot}档空着</h2>
            <p class="digest">还没有稿。点下方交本档，或等「今天三档都空」时自动补演示。</p>
          </div>
          ${thumbHtml(null)}
        </div>
        <details class="compose">
          <summary>交本档真稿</summary>
          ${composeForm(date, row)}
        </details>
      </article>
    `;
  }

  return `
    <article class="article-row${post.is_demo ? " is-demo" : ""}">
      <a class="article-main" href="/p/${encodeURIComponent(post.slug)}/">
        <div class="article-copy">
          ${articleMeta(post)}
          <h2>${escapeHtml(post.title)}</h2>
          <p class="digest">${escapeHtml(post.digest || post.note || "点开先看预览")}</p>
        </div>
        ${thumbHtml(post.preview_path)}
      </a>
    </article>
  `;
}

function composeForm(date: string, row: SlotRow, post: BoardPost | null = null): string {
  const slug = post?.slug || `${date.replaceAll("-", "")}-${row.slot === "早" ? "zao" : row.slot === "中" ? "zhong" : "wan"}`;
  const slugLocked = Boolean(post && !post.is_demo);
  return `
    <form data-form="upsert">
      <input type="hidden" name="slot" value="${row.slot}" />
      ${post ? `<input type="hidden" name="from_slug" value="${escapeHtml(post.slug)}" />` : ""}
      <label>slug</label>
      <input name="slug" required value="${escapeHtml(slug)}" ${slugLocked ? "readonly" : ""} />
      <label>标题</label>
      <input name="title" required value="${escapeHtml(post?.title || "")}" />
      <label>预览地址</label>
      <input name="preview_path" placeholder="/previews/zao/ 或同域预览路径" value="${escapeHtml(post?.preview_path || `/previews/${row.slot === "早" ? "zao" : row.slot === "中" ? "zhong" : "wan"}/`)}" />
      <label>备注</label>
      <textarea name="note" placeholder="给老板的一句话">${escapeHtml(post?.note || "")}</textarea>
      <button type="submit">${post?.status === "需改" ? "改完再交待审" : "标为待审"}</button>
    </form>
  `;
}

function queueRow(post: BoardPost): string {
  return `
    <article class="article-row is-queue">
      <a class="article-main" href="/p/${encodeURIComponent(post.slug)}/">
        <div class="article-copy">
          ${articleMeta(post)}
          <h2>${escapeHtml(post.title)}</h2>
          <p class="digest">${escapeHtml(post.digest || post.note || "点开预览审核")}</p>
        </div>
        ${thumbHtml(post.preview_path)}
      </a>
    </article>
  `;
}

async function renderDesk() {
  const account = await me();
  if (!account) {
    location.replace("/login");
    return;
  }

  const params = new URLSearchParams(location.search);
  const date = params.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date")!)
    ? params.get("date")!
    : todayShanghai();

  // 先上骨架屏，避免白板等待
  app.className = "";
  app.innerHTML = `
    ${masthead(account)}
    <div class="skel-block" aria-hidden="true">
      <div class="skel skel-title"></div>
      <div class="skel skel-row"></div>
      <div class="skel skel-row"></div>
      <div class="skel skel-row"></div>
    </div>
  `;

  let data;
  try {
    data = await board(date);
  } catch (error) {
    app.className = "";
    app.innerHTML = `${masthead(account)}<p class="error">${escapeHtml(errText(error, "看板加载失败"))}</p>`;
    bindLogout();
    return;
  }

  const isToday = date === data.today;
  const pendingHere = data.slots.filter((row) => row.post?.status === "待审").length;

  app.className = "";
  app.innerHTML = `
    ${masthead(account)}
    <section class="day-hero">
      <div class="day-hero-top">
        <div>
          <p class="eyebrow">${isToday ? "今天" : "日历"} · ${escapeHtml(account.brand)}</p>
          <h2 class="day-title">${formatZhDate(date)}</h2>
        </div>
        ${
          pendingHere
            ? `<a class="pending-pill" href="#queue">${pendingHere} 待审</a>`
            : `<span class="pending-pill is-quiet">排期中</span>`
        }
      </div>
      <ol class="flow-strip" aria-label="状态路径">
        <li>交待审</li>
        <li>通读</li>
        <li>过 / 要改 / 拒</li>
        <li>可推箱</li>
        <li>已进箱</li>
      </ol>
    </section>
    <nav class="date-nav" aria-label="换一天">
      <button class="secondary" type="button" data-shift="-1">前一天</button>
      <input id="date" type="date" value="${date}" aria-label="选择日期" />
      <button class="secondary" type="button" data-shift="1">后一天</button>
    </nav>
    ${isToday ? "" : `<p class="flash back-today"><a href="/">← 回到今天</a></p>`}
    <section class="paper-list slot-board" aria-label="今日早中晚">
      ${data.slots.map((row) => slotCard(date, row)).join("")}
    </section>
    <section class="queue" id="queue" aria-label="待审队列">
      <div class="section-head">
        <h2>待审队列</h2>
        <span class="count${data.queue.length ? "" : " is-zero"}">${data.queue.length}</span>
      </div>
      ${
        data.queue.length
          ? `<div class="paper-list">${data.queue.map(queueRow).join("")}</div>`
          : `<p class="empty-hint">队列是空的。交待审后会出现在这里；过了才可推箱。</p>`
      }
    </section>
  `;

  bindLogout();
  bindDeskNav(date);
  bindUpsert(date);
  bindEditorActions();
  bindBrokenCovers(app);
  drainFlash();
}

function bindDeskNav(date: string) {
  app.querySelector<HTMLInputElement>("#date")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLInputElement).value;
    location.search = `?date=${value}`;
  });

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-shift]")) {
    button.addEventListener("click", () => {
      location.search = `?date=${shiftDate(date, Number(button.dataset.shift))}`;
    });
  }

  // 桌面键盘：←/→ 换一天（输入框聚焦时不抢）
  window.addEventListener("keydown", (event) => {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowLeft") location.search = `?date=${shiftDate(date, -1)}`;
    if (event.key === "ArrowRight") location.search = `?date=${shiftDate(date, 1)}`;
  });
}

function bindUpsert(date: string) {
  for (const form of app.querySelectorAll<HTMLFormElement>("[data-form=upsert]")) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const box = new FormData(form);
      try {
        const slug = String(box.get("slug"));
        const fromSlug = box.get("from_slug") ? String(box.get("from_slug")) : "";
        await upsertPost({
          slug,
          from_slug: fromSlug || undefined,
          new_slug: fromSlug && fromSlug !== slug ? slug : undefined,
          title: String(box.get("title")),
          slot: String(box.get("slot")) as SlotRow["slot"],
          publish_date: date,
          preview_path: String(box.get("preview_path") || ""),
          note: String(box.get("note") || ""),
          submit: true,
        });
        flashToast("已交待审", "ok");
        location.reload();
      } catch (error) {
        showToast(errText(error, "保存失败"), "err");
      }
    });
  }
}

function bindLogout() {
  app.querySelector("[data-action=logout]")?.addEventListener("click", async () => {
    await logout();
    location.replace("/login");
  });
}

function postToolsHtml(post: BoardPost): string {
  const tools = demoTools(post, post.publish_date);
  if (!tools.trim()) return "";
  return `
    <section class="post-tools" aria-label="稿件操作">
      <p class="eyebrow">稿件操作</p>
      ${tools}
    </section>
  `;
}

function reviewDock(post: BoardPost): string {
  if (post.status === "待审") {
    return `
      <section class="${reviewDockLockClass({ locked: true, allowManualUnlock: false })}" aria-label="审核动作">
        ${pendingReviewActionsHtml(post.slug, true)}
      </section>
    `;
  }

  if (post.status === "可推箱") {
    return `
      <section class="dock dock-pass" aria-label="可推箱">
        <div class="pass-banner">
          <span class="stamp st s-可推箱 st-可推箱">可推箱</span>
          ${demoChip(post)}
          <p class="pass-lead">已过审。去微信后台推进草稿箱，回来点「已进箱」。</p>
          <p class="hint">要重审：撤回待审。演示稿可撤掉腾档。</p>
        </div>
        <div class="dock-actions dock-edit-actions">
          <button type="button" data-boxed="${post.slug}">已进箱</button>
          <button class="secondary" type="button" data-withdraw="${post.slug}">撤回待审</button>
          <button class="secondary" type="button" data-discard="${post.slug}">弃用</button>
        </div>
      </section>
    `;
  }

  if (post.status === "弃用") {
    return `
      <section class="dock dock-done" aria-label="弃用">
        <span class="stamp st s-弃用 st-弃用">弃用</span>
        <p class="hint">${escapeHtml(post.note || "已弃用")}。档位已释放，可换个 slug 重新交稿。</p>
      </section>
    `;
  }

  if (post.status === "已进箱") {
    return `
      <section class="dock dock-done" aria-label="已进箱">
        <span class="stamp st s-已进箱 st-已进箱">已进箱</span>
        ${demoChip(post)}
        <p class="hint">已回执。审核钮收起。编辑可「撤回待审」再过 / 要改 / 拒。</p>
        <div class="dock-actions dock-edit-actions">
          <button class="secondary" type="button" data-withdraw="${post.slug}">撤回待审</button>
        </div>
      </section>
    `;
  }

  if (post.status === "需改" || post.status === "draft") {
    const slot = post.slot || "早";
    return `
      <section class="dock dock-edit" aria-label="编辑再交">
        ${post.status === "需改" ? `<p class="flash">${escapeHtml(post.note || "需改")}</p>` : `<p class="hint">草稿还未交审。</p>`}
        ${
          post.status === "需改"
            ? `<p class="hint">改完再交，或直接「撤回待审」让老板再审当前预览。</p>
               <button class="secondary" type="button" data-withdraw="${post.slug}">撤回待审</button>`
            : ""
        }
        <button class="secondary" type="button" data-discard="${post.slug}">弃用这篇</button>
        ${composeForm(post.publish_date, { slot, post }, post)}
      </section>
    `;
  }

  return "";
}

async function renderPreview() {
  const slug = previewSlug();
  const account = await me();
  if (!account) {
    location.replace(`/login?next=/p/${slug}/`);
    return;
  }
  if (!slug) {
    app.className = "";
    app.innerHTML = `${masthead(account)}<p class="error">预览地址无效</p>`;
    bindLogout();
    return;
  }

  try {
    const data = await getPost(slug);
    const src = previewSrc(data.post);
    const back = `/?date=${encodeURIComponent(data.post.publish_date)}`;
    app.className = "is-review";
    app.innerHTML = `
      <header class="slim-bar">
        <a class="back-link" href="${back}">← 看板</a>
        <span class="slim-status ${statusChipClass(data.post.status)}">${statusLabel(data.post.status)}</span>
        <div class="read-progress" aria-hidden="true"><span id="read-progress-bar"></span></div>
      </header>
      <main class="article-stage">
        <div class="preview-article" id="preview-article"></div>
        <div class="read-end" id="read-end" aria-hidden="true"></div>
        ${postToolsHtml(data.post)}
      </main>
      ${reviewDock(data.post)}
    `;
    const embed = await mountPreview(app.querySelector<HTMLElement>("#preview-article")!, src, slug);
    bindDockClearance();
    bindUpsert(data.post.publish_date);
    bindReview();
    bindEditorActions();
    bindBrokenCovers(app);
    bindReadGate(embed);
    drainFlash();
  } catch (error) {
    app.className = "";
    app.innerHTML = `${masthead(account)}<p class="error">${escapeHtml(error instanceof Error ? error.message : "预览失败")}</p>`;
    bindLogout();
  }
}

type EmbedMode = "inline" | "iframe" | "empty";

async function mountPreview(host: HTMLElement, src: string | null, slug: string): Promise<EmbedMode> {
  if (!src) {
    host.innerHTML = `<div class="preview-empty"><p class="hint">没有可内嵌的 preview_path。补上预览地址后这里就是成稿 H5。</p></div>`;
    return "empty";
  }

  const origin = location.origin;
  if (canInlinePreview(src, origin)) {
    const fetched = await fetchSameOriginHtml(src);
    if (fetched.ok === false && fetched.reason === "login") {
      location.replace(`/login?next=/p/${encodeURIComponent(slug)}/`);
      return "empty";
    }
    if (fetched.ok) {
      const prepared = prepareInlineArticle(fetched.html, src, origin);
      if (prepared) {
        mountSanitizedArticle(host, prepared.articleHtml, prepared.stylesheets);
        return "inline";
      }
    }
    host.innerHTML = sandboxedIframeMarkup(src, true);
    fitSameOriginIframe(host.querySelector("iframe"));
    return "iframe";
  }

  host.innerHTML = sandboxedIframeMarkup(src, false);
  return "iframe";
}

function mountSanitizedArticle(host: HTMLElement, html: string, stylesheets: string[]) {
  const shadow = host.attachShadow({ mode: "open" });
  const parsed = new DOMParser().parseFromString(`<div class="preview-root">${html}</div>`, "text/html");
  for (const el of parsed.querySelectorAll("script, iframe, object, embed, form, link, meta, base, svg, math, template, noscript")) {
    el.remove();
  }
  for (const el of parsed.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on") || attr.name === "srcdoc") el.removeAttribute(attr.name);
      if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^(javascript:|vbscript:|data:\s*text\/html)/i.test(attr.value)) {
        el.setAttribute(attr.name, "#");
      }
    }
  }
  const root = parsed.body.firstElementChild;
  const reset = document.createElement("style");
  reset.textContent = `:host{display:block;background:#fff;color:#1a1a1a;font-size:17px;line-height:1.75} .preview-root{display:block}`;
  shadow.append(reset);
  for (const href of stylesheets) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.append(link);
  }
  if (root) shadow.append(root);
}

function fitSameOriginIframe(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;
  const apply = () => {
    try {
      const doc = iframe.contentDocument;
      const height = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
      if (height) {
        iframe.style.height = `${height}px`;
        iframe.classList.add("is-fitted");
      }
    } catch {
      /* cross-origin */
    }
  };
  iframe.addEventListener("load", apply);
  apply();
}

/* 动态给正文底部留足空间，避免浮动 dock 遮挡结尾 */
function bindDockClearance() {
  const dock = app.querySelector<HTMLElement>(".dock");
  const stage = app.querySelector<HTMLElement>(".article-stage");
  if (!dock || !stage) return;
  const apply = () => {
    const bottomGap = 24; // dock 与正文末尾的呼吸距离
    const offset = Number.parseFloat(getComputedStyle(dock).bottom) || 0;
    stage.style.paddingBottom = `${dock.offsetHeight + offset + bottomGap}px`;
  };
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(dock);
  window.addEventListener("resize", apply);
  apply();
}

function unlockReviewDock() {
  const dock = app.querySelector<HTMLElement>(".dock-review");
  if (!dock) return;
  dock.classList.remove("is-locked", "has-manual-unlock");
  for (const button of dock.querySelectorAll<HTMLButtonElement>("[data-review]")) {
    button.disabled = false;
  }
}

function bindReadGate(embed: EmbedMode) {
  const dock = app.querySelector<HTMLElement>(".dock-review");
  if (!dock) return;

  const unlock = () => unlockReviewDock();

  if (embed === "empty") {
    unlock();
    return;
  }

  const sentinel = app.querySelector("#read-end");
  if (embed === "inline") {
    if (sentinel && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            unlock();
            io.disconnect();
          }
        },
        { root: null, threshold: 0, rootMargin: `0px 0px ${READ_GATE_SLACK_PX}px 0px` },
      );
      io.observe(sentinel);
    }

    const checkWindow = () => {
      const bar = app.querySelector<HTMLElement>("#read-progress-bar");
      if (bar) {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        const pct = total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 100;
        bar.style.width = `${pct}%`;
      }
      if (
        isReadComplete({
          scrollTop: window.scrollY,
          clientHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        })
      ) {
        unlock();
      }
    };
    window.addEventListener("scroll", checkWindow, { passive: true });
    window.addEventListener("resize", checkWindow);
    requestAnimationFrame(checkWindow);
  }

  const iframe = app.querySelector<HTMLIFrameElement>(".preview-frame");
  if (embed === "iframe" && iframe) {
    dock.classList.add("has-manual-unlock");
    const bindFrame = () => {
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (!win || !doc) return false;
        const check = () => {
          if (
            isReadComplete({
              scrollTop: win.scrollY,
              clientHeight: win.innerHeight,
              scrollHeight: doc.documentElement.scrollHeight,
            })
          ) {
            unlock();
          }
        };
        win.addEventListener("scroll", check, { passive: true });
        check();
        return true;
      } catch {
        return false;
      }
    };
    iframe.addEventListener("load", () => {
      if (!bindFrame()) dock.classList.add("has-manual-unlock");
    });
  }

  app.querySelector("[data-read-done]")?.addEventListener("click", unlock);
}

function bindReview() {
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-review]")) {
    const action = button.dataset.review as "过" | "要改" | "拒";
    const run = async () => {
      if (button.closest(".dock-review")?.classList.contains("is-locked")) return;
      const note = app.querySelector<HTMLTextAreaElement>("[name=review_note]")?.value || "";
      button.disabled = true;
      try {
        await review(button.dataset.slug!, action, note);
        flashToast(
          action === "过" ? "已过审，进可推箱" : "已标为需改，编辑改完可再交",
          "ok",
        );
        location.reload();
      } catch (error) {
        button.disabled = false;
        showToast(errText(error, "审核失败"), "err");
      }
    };
    if (action === "拒") {
      bindTwoTap(button, "确认拒绝？再点一次", run);
    } else {
      button.addEventListener("click", () => void run());
    }
  }

  const boxed = app.querySelector<HTMLButtonElement>("[data-boxed]");
  boxed?.addEventListener("click", async () => {
    boxed.disabled = true;
    try {
      await markBoxed(boxed.dataset.boxed!);
      flashToast("已回执：进箱完成", "ok");
      location.reload();
    } catch (error) {
      boxed.disabled = false;
      showToast(errText(error, "更新失败"), "err");
    }
  });
}

function bindEditorActions() {
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-withdraw]")) {
    bindTwoTap(button, "确认撤回？再点一次", async () => {
      await withdrawPost(button.dataset.withdraw!);
      flashToast("已撤回待审", "ok");
      location.reload();
    });
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-discard]")) {
    bindTwoTap(button, "确认弃用？再点一次", async () => {
      await discardPost(button.dataset.discard!);
      flashToast("已弃用，档位已释放", "ok");
      location.reload();
    });
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-official]")) {
    bindTwoTap(button, "确认转正式？再点一次", async () => {
      await patchPost(button.dataset.official!, { mark_official: true });
      flashToast("已标为正式稿", "ok");
      location.reload();
    });
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-release]")) {
    bindTwoTap(button, "确认撤档？再点一次", async () => {
      await releaseDemo(button.dataset.release!);
      flashToast("演示稿已撤档", "ok");
      location.href = "/";
    });
  }
}

async function boot() {
  const page = route();
  if (page === "login") await renderLogin();
  else if (page === "preview") await renderPreview();
  else await renderDesk();
}

void boot();
