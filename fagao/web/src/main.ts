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
        <button type="submit" id="send" class="btn-primary-block">发送验证码</button>
        <label for="code">6 位验证码</label>
        <div class="code-row">
          <input id="code" name="code" inputmode="numeric" pattern="\d{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" />
          <button class="btn-primary-block" type="button" id="verify">登录</button>
        </div>
      </form>
      <p class="hint msg-line" id="msg" role="status"></p>
    </section>
  `;

  const msg = app.querySelector<HTMLParagraphElement>("#msg")!;
  const email = app.querySelector<HTMLInputElement>("#email")!;
  const code = app.querySelector<HTMLInputElement>("#code")!;

  app.querySelector<HTMLFormElement>("#otp-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "发送中…";
    try {
      const res = await requestOtp(email.value);
      msg.textContent = res.dev_otp
        ? `本地开发码：${res.dev_otp}（无 Resend 时写入日志）`
        : res.message;
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : "发送失败";
    }
  });

  app.querySelector<HTMLButtonElement>("#verify")!.addEventListener("click", async () => {
    msg.textContent = "校验中…";
    try {
      await verifyOtp(email.value, code.value);
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.replace(next.startsWith("/") ? next : "/");
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : "登录失败";
    }
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

  let data;
  try {
    data = await board(date);
  } catch (error) {
    app.className = "";
    app.innerHTML = `${masthead(account)}<p class="error">${escapeHtml(error instanceof Error ? error.message : "看板加载失败")}</p>`;
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
        location.reload();
      } catch (error) {
        alert(error instanceof Error ? error.message : "保存失败");
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

function reviewDock(post: BoardPost): string {
  if (post.status === "待审") {
    return `
      <section class="${reviewDockLockClass({ locked: true, allowManualUnlock: false })}" aria-label="审核动作">
        ${pendingReviewActionsHtml(post.slug, true)}
        ${demoTools(post, post.publish_date)}
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
        </div>
        ${demoTools(post, post.publish_date)}
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
        ${demoTools(post, post.publish_date)}
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
        ${composeForm(post.publish_date, { slot, post }, post)}
        ${demoTools(post, post.publish_date)}
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
      </header>
      <main class="article-stage">
        <div class="preview-article" id="preview-article"></div>
        <div class="read-end" id="read-end" aria-hidden="true"></div>
      </main>
      ${reviewDock(data.post)}
    `;
    const embed = await mountPreview(app.querySelector<HTMLElement>("#preview-article")!, src, slug);
    bindUpsert(data.post.publish_date);
    bindReview();
    bindEditorActions();
    bindBrokenCovers(app);
    bindReadGate(embed);
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
    button.addEventListener("click", async () => {
      if (button.closest(".dock-review")?.classList.contains("is-locked")) return;
      const action = button.dataset.review as "过" | "要改" | "拒";
      const note = app.querySelector<HTMLTextAreaElement>("[name=review_note]")?.value || "";
      if (action === "拒" && !confirm("确认拒绝？稿件将标为需改，编辑改完可再交审。")) return;
      button.disabled = true;
      try {
        await review(button.dataset.slug!, action, note);
        location.reload();
      } catch (error) {
        button.disabled = false;
        alert(error instanceof Error ? error.message : "审核失败");
      }
    });
  }

  const boxed = app.querySelector<HTMLButtonElement>("[data-boxed]");
  boxed?.addEventListener("click", async () => {
    boxed.disabled = true;
    try {
      await markBoxed(boxed.dataset.boxed!);
      location.reload();
    } catch (error) {
      boxed.disabled = false;
      alert(error instanceof Error ? error.message : "更新失败");
    }
  });
}

function bindEditorActions() {
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-withdraw]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!confirm("撤回待审后，老板可以再过 / 要改 / 拒。继续？")) return;
      button.disabled = true;
      try {
        await withdrawPost(button.dataset.withdraw!);
        location.reload();
      } catch (error) {
        button.disabled = false;
        alert(error instanceof Error ? error.message : "撤回失败");
      }
    });
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-official]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!confirm("去掉「演示」标，按正式稿处理？slug 可随后在表单里改掉 kdp-MMDD-*。")) return;
      button.disabled = true;
      try {
        await patchPost(button.dataset.official!, { mark_official: true });
        location.reload();
      } catch (error) {
        button.disabled = false;
        alert(error instanceof Error ? error.message : "更新失败");
      }
    });
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-release]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!confirm("撤掉这条演示稿并腾出档位？当天不会再自动补演示。")) return;
      button.disabled = true;
      try {
        await releaseDemo(button.dataset.release!);
        location.href = "/";
      } catch (error) {
        button.disabled = false;
        alert(error instanceof Error ? error.message : "撤档失败");
      }
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
