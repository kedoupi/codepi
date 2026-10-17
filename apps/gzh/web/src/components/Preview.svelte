<script lang="ts">
  import { onMount } from "svelte";
  import type { Account, BoardPost } from "../api";
  import { getPost, markBoxed, review, withdrawPost } from "../api";
  import {
    expireSession,
    isSessionCurrent,
    sessionFetch,
    sessionVersion,
  } from "../session";
  import { previewSrc, statusChipClass, statusLabel, bindBrokenCovers } from "../format";
  import {
    canInlinePreview,
    fetchSameOriginHtml,
    prepareInlineArticle,
    sandboxedIframeMarkup,
  } from "../preview-embed";
  import {
    isReadComplete,
    READ_GATE_SLACK_PX,
  } from "../read-gate";
  import { drainFlash, errText, flashToast, showToast } from "../lib/toast";
  import Masthead from "./Masthead.svelte";
  import ComposeForm from "./ComposeForm.svelte";
  import DemoTools from "./DemoTools.svelte";
  import TwoTapButton from "./TwoTapButton.svelte";

  let { account, slug }: { account: Account; slug: string } = $props();

  type EmbedMode = "inline" | "iframe" | "empty";

  let post = $state<BoardPost | null>(null);
  let error = $state("");
  let embedHost: HTMLElement | undefined = $state();
  let embedMode = $state<EmbedMode>("empty");
  let reviewLocked = $state(true);
  let manualUnlock = $state(false);
  let readPct = $state(0);
  let dockEl: HTMLElement | undefined = $state();
  let stageEl: HTMLElement | undefined = $state();

  const back = $derived(post ? `/?date=${encodeURIComponent(post.publish_date)}` : "/");

  function unlockReviewDock() {
    reviewLocked = false;
  }

  /* 动态给正文底部留足空间，避免浮动 dock 遮挡结尾 */
  function bindDockClearance(cleanups: Array<() => void>) {
    const apply = () => {
      if (!dockEl || !stageEl) return;
      const bottomGap = 24;
      const offset = Number.parseFloat(getComputedStyle(dockEl).bottom) || 0;
      stageEl.style.paddingBottom = `${dockEl.offsetHeight + offset + bottomGap}px`;
    };
    if ("ResizeObserver" in window && dockEl) {
      const observer = new ResizeObserver(apply);
      observer.observe(dockEl);
      cleanups.push(() => observer.disconnect());
    }
    window.addEventListener("resize", apply);
    cleanups.push(() => window.removeEventListener("resize", apply));
    apply();
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

  async function mountPreview(host: HTMLElement, srcValue: string | null): Promise<EmbedMode> {
    if (!srcValue) {
      host.innerHTML = `<div class="preview-empty"><p class="hint">没有可内嵌的 preview_path。补上预览地址后这里就是成稿 H5。</p></div>`;
      return "empty";
    }

    const origin = location.origin;
    if (canInlinePreview(srcValue, origin)) {
      const version = sessionVersion();
      const fetched = await fetchSameOriginHtml(srcValue, sessionFetch);
      if (!isSessionCurrent(version)) return "empty";
      if (fetched.ok === false && fetched.reason === "login") {
        expireSession();
        location.replace(`/login?next=/p/${encodeURIComponent(slug)}/`);
        return "empty";
      }
      if (fetched.ok) {
        const prepared = prepareInlineArticle(fetched.html, srcValue, origin);
        if (prepared) {
          mountSanitizedArticle(host, prepared.articleHtml, prepared.stylesheets);
          return "inline";
        }
      }
      host.innerHTML = sandboxedIframeMarkup(srcValue, true);
      fitSameOriginIframe(host.querySelector("iframe"));
      return "iframe";
    }

    host.innerHTML = sandboxedIframeMarkup(srcValue, false);
    return "iframe";
  }

  function bindReadGate(mode: EmbedMode, cleanups: Array<() => void>) {
    if (!post || post.status !== "待审") return;
    if (mode === "empty") {
      unlockReviewDock();
      return;
    }

    if (mode === "inline") {
      const sentinel = stageEl?.querySelector("#read-end");
      if (sentinel && "IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              unlockReviewDock();
              io.disconnect();
            }
          },
          { root: null, threshold: 0, rootMargin: `0px 0px ${READ_GATE_SLACK_PX}px 0px` },
        );
        io.observe(sentinel);
        cleanups.push(() => io.disconnect());
      }

      const checkWindow = () => {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        readPct = total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 100;
        if (
          isReadComplete({
            scrollTop: window.scrollY,
            clientHeight: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
          })
        ) {
          unlockReviewDock();
        }
      };
      window.addEventListener("scroll", checkWindow, { passive: true });
      window.addEventListener("resize", checkWindow);
      cleanups.push(() => {
        window.removeEventListener("scroll", checkWindow);
        window.removeEventListener("resize", checkWindow);
      });
      const frame = requestAnimationFrame(checkWindow);
      cleanups.push(() => cancelAnimationFrame(frame));
    }

    if (mode === "iframe") {
      const iframe = embedHost?.querySelector<HTMLIFrameElement>(".preview-frame");
      if (iframe) {
        manualUnlock = true;
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
                unlockReviewDock();
              }
            };
            win.addEventListener("scroll", check, { passive: true });
            cleanups.push(() => win.removeEventListener("scroll", check));
            check();
            return true;
          } catch {
            return false;
          }
        };
        iframe.addEventListener("load", () => {
          if (!bindFrame()) manualUnlock = true;
        });
      }
    }
  }

  let reviewNote = $state("");
  let reviewBusy = $state("");

  async function runReview(action: "过" | "要改" | "拒") {
    if (!post || reviewLocked || reviewBusy) return;
    reviewBusy = action;
    try {
      await review(post.slug, action, reviewNote);
      flashToast(
        action === "过" ? "已过审，进可推箱" : action === "要改" ? "已标为需改，编辑改完可再交" : "已拒绝",
        "ok",
      );
      location.reload();
    } catch (e) {
      reviewBusy = "";
      showToast(errText(e, "审核失败"), "err");
    }
  }

  async function runBoxed() {
    if (!post || reviewBusy) return;
    reviewBusy = "boxed";
    try {
      await markBoxed(post.slug);
      flashToast("已回执：进箱完成", "ok");
      location.reload();
    } catch (e) {
      reviewBusy = "";
      showToast(errText(e, "更新失败"), "err");
    }
  }

  async function runWithdraw() {
    if (!post) return;
    await withdrawPost(post.slug);
    flashToast("已撤回待审", "ok");
    location.reload();
  }

  onMount(() => {
    const app = document.getElementById("app");
    app?.classList.add("is-review");
    if (!slug) {
      error = "预览地址无效";
      return () => app?.classList.remove("is-review");
    }
    const cleanups: Array<() => void> = [];
    const version = sessionVersion();
    (async () => {
      try {
        const data = await getPost(slug);
        if (!isSessionCurrent(version)) return;
        post = data.post;
        // 等 Svelte 渲染出 embedHost / dock / stage。
        await Promise.resolve();
        await Promise.resolve();
        if (!isSessionCurrent(version)) return;
        if (embedHost) {
          embedMode = await mountPreview(embedHost, previewSrc(data.post));
        }
        if (!isSessionCurrent(version)) return;
        bindDockClearance(cleanups);
        bindReadGate(embedMode, cleanups);
        if (stageEl) bindBrokenCovers(stageEl);
        drainFlash();
      } catch (e) {
        if (!isSessionCurrent(version)) return;
        error = errText(e, "预览失败");
      }
    })();
    return () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      app?.classList.remove("is-review");
    };
  });
</script>

{#if error}
  <Masthead {account} />
  <p class="error">{error}</p>
{:else if !post}
  <header class="slim-bar">
    <a class="back-link" href="/">← 看板</a>
    <span class="slim-status">加载中</span>
  </header>
{:else}
  <header class="slim-bar">
    <a class="back-link" href={back}>← 看板</a>
    <span class="slim-status {statusChipClass(post.status)}">{statusLabel(post.status)}</span>
    <div class="read-progress" aria-hidden="true"><span id="read-progress-bar" style:width="{readPct}%"></span></div>
  </header>
  <main class="article-stage" bind:this={stageEl}>
    <div class="preview-article" id="preview-article" bind:this={embedHost}></div>
    <div class="read-end" id="read-end" aria-hidden="true"></div>
    {#if post.is_demo && post.slot}
      <section class="post-tools" aria-label="稿件操作">
        <p class="eyebrow">稿件操作</p>
        <DemoTools date={post.publish_date} {post} />
      </section>
    {/if}
  </main>

  {#if post.status === "待审"}
    <section
      class="dock dock-review"
      class:is-locked={reviewLocked}
      class:has-manual-unlock={manualUnlock}
      aria-label="审核动作"
      bind:this={dockEl}
    >
      <p class="read-hint" data-read-hint role="status">请先通读全文</p>
      <button class="secondary read-done-btn" type="button" data-read-done onclick={unlockReviewDock}>已读完，解锁审核</button>
      <div class="dock-actions" data-review-actions>
        <button class="btn-pass" type="button" data-review="过" disabled={reviewLocked || reviewBusy !== ""} onclick={() => void runReview("过")}>过</button>
        <button class="btn-change" type="button" data-review="要改" disabled={reviewLocked || reviewBusy !== ""} onclick={() => void runReview("要改")}>要改</button>
        <TwoTapButton
          class="btn-reject"
          label="拒"
          confirmLabel="确认拒绝？再点一次"
          onConfirm={() => runReview("拒")}
        />
      </div>
      <details class="dock-note" data-review-note>
        <summary>写意见（可选）</summary>
        <label class="sr-only" for="review_note">审核意见</label>
        <textarea id="review_note" name="review_note" placeholder="要改时建议写清；拒也可以写原因" bind:value={reviewNote}></textarea>
      </details>
    </section>
  {:else if post.status === "可推箱"}
    <section class="dock dock-pass" aria-label="可推箱" bind:this={dockEl}>
      <div class="pass-banner">
        <span class="stamp st s-可推箱 st-可推箱">可推箱</span>
        {#if post.is_demo}<span class="demo-tag">演示</span>{/if}
        <p class="pass-lead">已过审。去微信后台推进草稿箱，回来点「已进箱」。</p>
        <p class="hint">要重审：撤回待审。演示稿可撤掉腾档。</p>
      </div>
      <div class="dock-actions dock-edit-actions">
        <button type="button" disabled={reviewBusy !== ""} onclick={() => void runBoxed()}>已进箱</button>
        <TwoTapButton class="secondary" label="撤回待审" confirmLabel="确认撤回？再点一次" onConfirm={runWithdraw} />
      </div>
    </section>
  {:else if post.status === "已进箱"}
    <section class="dock dock-done" aria-label="已进箱" bind:this={dockEl}>
      <span class="stamp st s-已进箱 st-已进箱">已进箱</span>
      {#if post.is_demo}<span class="demo-tag">演示</span>{/if}
      <p class="hint">已回执。审核钮收起。编辑可「撤回待审」再过 / 要改 / 拒。</p>
      <div class="dock-actions dock-edit-actions">
        <TwoTapButton class="secondary" label="撤回待审" confirmLabel="确认撤回？再点一次" onConfirm={runWithdraw} />
      </div>
    </section>
  {:else if post.status === "需改" || post.status === "draft"}
    <section class="dock dock-edit" aria-label="编辑再交" bind:this={dockEl}>
      {#if post.status === "需改"}
        <p class="flash">{post.note || "需改"}</p>
        <p class="hint">改完再交，或直接「撤回待审」让老板再审当前预览。</p>
        <TwoTapButton class="secondary" label="撤回待审" confirmLabel="确认撤回？再点一次" onConfirm={runWithdraw} />
      {:else}
        <p class="hint">草稿还未交审。</p>
      {/if}
      <ComposeForm date={post.publish_date} row={{ slot: post.slot || "早", post }} {post} />
    </section>
  {/if}
{/if}
