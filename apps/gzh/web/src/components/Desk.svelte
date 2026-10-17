<script lang="ts">
  import { onMount } from "svelte";
  import type { Account, BoardData, BoardPost } from "../api";
  import { board, shiftDate, todayShanghai } from "../api";
  import { isSessionCurrent, sessionVersion } from "../session";
  import { bindBrokenCovers, coverSrc, formatZhDate, slotHint, statusChipClass, statusLabel, thumbClass } from "../format";
  import { drainFlash, errText } from "../lib/toast";
  import Masthead from "./Masthead.svelte";
  import ComposeForm from "./ComposeForm.svelte";

  let { account }: { account: Account } = $props();

  const params = new URLSearchParams(location.search);
  const date =
    params.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date")!)
      ? params.get("date")!
      : todayShanghai();

  let data = $state<BoardData | null>(null);
  let error = $state("");

  const isToday = $derived(data ? date === data.today : true);
  const pendingHere = $derived(
    data ? data.slots.filter((row) => row.post?.status === "待审").length : 0,
  );

  function demoChip(post: BoardPost | null) {
    return post?.is_demo ?? false;
  }

  let host: HTMLElement | undefined = $state();

  function gotoDate(value: string) {
    location.search = `?date=${value}`;
  }

  function onKeydown(event: KeyboardEvent) {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowLeft") gotoDate(shiftDate(date, -1));
    if (event.key === "ArrowRight") gotoDate(shiftDate(date, 1));
  }

  onMount(() => {
    const version = sessionVersion();
    window.addEventListener("keydown", onKeydown);
    (async () => {
      try {
        const result = await board(date);
        if (!isSessionCurrent(version)) return;
        data = result;
        // 等 DOM 更新后绑定断图处理与 flash。
        await Promise.resolve();
        if (host) bindBrokenCovers(host);
        drainFlash();
      } catch (e) {
        if (!isSessionCurrent(version)) return;
        error = errText(e, "看板加载失败");
      }
    })();
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

<div bind:this={host}>
  <Masthead {account} />
  {#if error}
    <p class="error">{error}</p>
  {:else if !data}
    <div class="skel-block" aria-hidden="true">
      <div class="skel skel-title"></div>
      <div class="skel skel-row"></div>
      <div class="skel skel-row"></div>
      <div class="skel skel-row"></div>
    </div>
  {:else}
    <section class="day-hero">
      <div class="day-hero-top">
        <div>
          <p class="eyebrow">{isToday ? "今天" : "日历"} · {account.brand}</p>
          <h2 class="day-title">{formatZhDate(date)}</h2>
        </div>
        {#if pendingHere}
          <a class="pending-pill" href="#queue">{pendingHere} 待审</a>
        {:else}
          <span class="pending-pill is-quiet">排期中</span>
        {/if}
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
      <button class="secondary" type="button" onclick={() => gotoDate(shiftDate(date, -1))}>前一天</button>
      <input id="date" type="date" value={date} aria-label="选择日期" onchange={(e) => gotoDate((e.target as HTMLInputElement).value)} />
      <button class="secondary" type="button" onclick={() => gotoDate(shiftDate(date, 1))}>后一天</button>
    </nav>
    {#if !isToday}
      <p class="flash back-today"><a href="/">← 回到今天</a></p>
    {/if}
    <section class="paper-list slot-board" aria-label="今日早中晚">
      {#each data.slots as row (row.slot)}
        {@const post = row.post}
        {#if !post}
          <article class="article-row is-empty">
            <div class="article-main">
              <div class="article-copy">
                <p class="article-meta"><span class="slot-chip">{row.slot}</span><span>{slotHint(row.slot)}</span></p>
                <h2 class="empty-title">{row.slot}档空着</h2>
                <p class="digest">还没有稿。点下方交本档，或等「今天三档都空」时自动补演示。</p>
              </div>
              <div class={thumbClass(null)} aria-hidden="true"></div>
            </div>
            <details class="compose">
              <summary>交本档真稿</summary>
              <ComposeForm {date} {row} />
            </details>
          </article>
        {:else}
          <article class="article-row" class:is-demo={post.is_demo}>
            <a class="article-main" href="/p/{encodeURIComponent(post.slug)}/">
              <div class="article-copy">
                <p class="article-meta">
                  {#if post.slot}<span class="slot-chip">{post.slot}</span>{/if}
                  <span class={statusChipClass(post.status)}>{statusLabel(post.status)}</span>
                  {#if demoChip(post)}<span class="demo-tag">演示</span>{/if}
                  <span>{post.slot ? slotHint(post.slot) : post.publish_date}</span>
                </p>
                <h2>{post.title}</h2>
                <p class="digest">{post.digest || post.note || "点开先看预览"}</p>
              </div>
              {#if coverSrc(post.preview_path)}
                <div class={thumbClass(post.preview_path)} aria-hidden="true"><img src={coverSrc(post.preview_path)} alt="" loading="lazy" decoding="async" data-cover /></div>
              {:else}
                <div class={thumbClass(post.preview_path)} aria-hidden="true"></div>
              {/if}
            </a>
          </article>
        {/if}
      {/each}
    </section>
    <section class="queue" id="queue" aria-label="待审队列">
      <div class="section-head">
        <h2>待审队列</h2>
        <span class="count" class:is-zero={!data.queue.length}>{data.queue.length}</span>
      </div>
      {#if data.queue.length}
        <div class="paper-list">
          {#each data.queue as post (post.slug)}
            <article class="article-row is-queue">
              <a class="article-main" href="/p/{encodeURIComponent(post.slug)}/">
                <div class="article-copy">
                  <p class="article-meta">
                    {#if post.slot}<span class="slot-chip">{post.slot}</span>{/if}
                    <span class={statusChipClass(post.status)}>{statusLabel(post.status)}</span>
                    {#if demoChip(post)}<span class="demo-tag">演示</span>{/if}
                    <span>{post.slot ? slotHint(post.slot) : post.publish_date}</span>
                  </p>
                  <h2>{post.title}</h2>
                  <p class="digest">{post.digest || post.note || "点开预览审核"}</p>
                </div>
                {#if coverSrc(post.preview_path)}
                <div class={thumbClass(post.preview_path)} aria-hidden="true"><img src={coverSrc(post.preview_path)} alt="" loading="lazy" decoding="async" data-cover /></div>
              {:else}
                <div class={thumbClass(post.preview_path)} aria-hidden="true"></div>
              {/if}
              </a>
            </article>
          {/each}
        </div>
      {:else}
        <p class="empty-hint">队列是空的。交待审后会出现在这里；过了才可推箱。</p>
      {/if}
    </section>
  {/if}
</div>
