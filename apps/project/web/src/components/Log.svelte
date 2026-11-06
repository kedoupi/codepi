<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { longDay, projectSlot } from "../lib/format";
  import type { ProjectSummary } from "../lib/types";

  type Card = { project: string; title: string; summary: string | null; at: string | null };
  type Check = Card & { note: string };
  type JournalDay = {
    date: string;
    count: number;
    counts: { completed: number; changed: number };
    released: Card[];
    completed: Card[];
    checked: Check[];
    other: Card[];
  };
  type Journal = {
    as_of: string;
    week: { start: string; end: string };
    summary: { completed: number; released: number; checked: number };
    days: JournalDay[];
    truncated: boolean;
  };

  let { projects }: { projects: ProjectSummary[] } = $props();
  let data = $state<Journal | null>(null);
  let loaded = $state(false);
  let error = $state("");
  let project = $state("");
  let week = $state(new URLSearchParams(location.search).get("week") || "");
  let expandedDone = $state(new Set<string>());
  let loadSequence = 0;

  async function load() {
    const request = ++loadSequence;
    loaded = false;
    data = null;
    try {
      const params = new URLSearchParams();
      if (week) params.set("week", week);
      const result = await api(`/api/journal${params.size ? `?${params}` : ""}`) as unknown as Journal;
      if (request !== loadSequence) return;
      data = result;
      error = "";
    } catch (cause) {
      if (request !== loadSequence) return;
      error = cause instanceof Error ? cause.message : "读取失败";
    } finally {
      if (request === loadSequence) loaded = true;
    }
  }

  onMount(() => {
    void load();
    const onPop = () => {
      week = new URLSearchParams(location.search).get("week") || "";
      void load();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  const today = $derived(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
  const shownDays = $derived.by(() => (data?.days ?? []).map(day => {
    const released = filterCards(day.released);
    const completed = filterCards(day.completed);
    const checked = filterCards(day.checked) as Check[];
    const other = filterCards(day.other);
    return { ...day, released, completed, checked, other,
      counts: { completed: completed.length, changed: released.length + other.length },
      count: completed.length + released.length + other.length };
  }));
  const shownSummary = $derived({
    completed: shownDays.reduce((total, day) => total + day.completed.length, 0),
    released: shownDays.reduce((total, day) => total + day.released.length, 0),
    checked: shownDays.reduce((total, day) => total + day.checked.length, 0),
  });
  const maxCount = $derived(Math.max(1, ...shownDays.map(day => day.released.length + day.other.length + day.completed.length)));

  function filterCards<T extends Card>(cards: T[]) {
    return cards.filter(card => !project || card.project === project);
  }

  function level(day: JournalDay) {
    const count = day.released.length + day.other.length + day.completed.length;
    return count === 0 ? 0 : Math.max(1, Math.ceil((count / maxCount) * 4));
  }

  function shift(day: string, amount: number) {
    return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400_000).toISOString().slice(0, 10);
  }

  function selectWeek(value: string) {
    week = value;
    const url = new URL(location.href);
    if (value) url.searchParams.set("week", value);
    else url.searchParams.delete("week");
    history.pushState(null, "", `${url.pathname}${url.search}`);
    void load();
  }

  function jump(date: string) {
    if (date > today) return;
    const target = document.getElementById(`journal-day-${date}`);
    if (!(target instanceof HTMLDetailsElement)) return;
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleDone(date: string) {
    const next = new Set(expandedDone);
    if (next.has(date)) next.delete(date); else next.add(date);
    expandedDone = next;
  }

  function projectName(id: string) {
    return projects.find(item => item.id === id)?.name ?? id;
  }
</script>

{#if error}
  <p class="inline-alert" role="alert">{error}</p>
{:else if !loaded || !data}
  <p class="loading">正在读取工作日报…</p>
{:else}
  <header class="page-head journal-head">
    <div>
      <h1>动态 <span class="muted">工作日报</span></h1>
      <p class="journal-week">{data.week.start} 至 {data.week.end}</p>
    </div>
    {#if projects.length > 1}
      <select aria-label="项目" bind:value={project}>
        <option value="">全部项目</option>
        {#each projects as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
    {/if}
  </header>

  <nav class="journal-week-nav" aria-label="周切换">
    <button class="button" onclick={() => selectWeek(shift(data!.week.start, -7))}>上一周</button>
    <button class="button" onclick={() => selectWeek("")} disabled={!week}>本周</button>
    <button class="button" onclick={() => selectWeek(shift(data!.week.start, 7))}>下一周</button>
  </nav>

  <section class="journal-summary" aria-label="本周汇总">
    <div class="journal-stat"><b>{shownSummary.completed}</b><span>完成</span></div>
    <div class="journal-stat"><b>{shownSummary.released}</b><span>上线</span></div>
    <div class="journal-stat"><b>{shownSummary.checked}</b><span>查过</span></div>
  </section>

  <nav class="journal-week-grid" aria-label="本周每天">
    {#each shownDays as day (day.date)}
      {@const count = day.released.length + day.other.length + day.completed.length}
      <button class={`journal-day-cell heat-${level(day)}`} class:is-today={day.date === today} class:is-future={day.date > today}
        disabled={day.date > today} aria-label={`${day.date} ${count} 条`} onclick={() => jump(day.date)}>
        <time datetime={day.date}>{day.date.slice(5)}</time><b>{count}</b>
      </button>
    {/each}
  </nav>

  {#if data.truncated}<p class="footnote">本周数据超过 500 条，日报已截断。</p>{/if}

  <div class="journal-days">
    {#each shownDays as day (day.date)}
      {@const doneExpanded = expandedDone.has(day.date)}
      <details id={`journal-day-${day.date}`} class="journal-day" class:journal-today={day.date === today} open={day.date >= today}>
        <summary><h2><time datetime={day.date}>{longDay(day.date)}</time><span>{day.counts.completed + day.counts.changed} 条</span></h2></summary>
        {#if day.released.length}
          <section class="journal-block"><h3>上线 <small>{day.released.length}</small></h3><ul class="journal-list">
            {#each day.released as item, index (`release-${item.project}-${index}`)}<li><span class={`dot slot-${projectSlot(projects, item.project)}`}></span><span>{item.title}</span>{#if projects.length > 1}<small>{projectName(item.project)}</small>{/if}</li>{/each}
          </ul></section>
        {/if}
        {#if day.completed.length}
          <section class="journal-block"><h3>完成 <small>{day.completed.length}</small></h3><ul class="journal-list">
            {#each (doneExpanded ? day.completed : day.completed.slice(0, 3)) as item, index (`done-${item.project}-${index}`)}<li class="journal-done"><span class="journal-check">✓</span><span>{item.title}</span>{#if projects.length > 1}<small>{projectName(item.project)}</small>{/if}</li>{/each}
          </ul>
          {#if day.completed.length > 3}<button class="link-button journal-more" onclick={() => toggleDone(day.date)}>{doneExpanded ? "收起完成事项" : `另 ${day.completed.length - 3} 件`}</button>{/if}</section>
        {/if}
        {#if day.checked.length}
          <section class="journal-block"><h3>查过 <small>{day.checked.length}</small></h3><ul class="journal-list">
            {#each day.checked as item, index (`checked-${item.project}-${index}`)}<li><span class="journal-check">⌕</span><span>{item.title}<em>{item.note}</em></span>{#if projects.length > 1}<small>{projectName(item.project)}</small>{/if}</li>{/each}
          </ul></section>
        {/if}
        {#if day.other.length}
          <details class="journal-block journal-other"><summary>另有 {day.other.length} 条改动</summary><ul class="journal-list">
            {#each day.other as item, index (`other-${item.project}-${index}`)}<li><span class={`dot slot-${projectSlot(projects, item.project)}`}></span><span>{item.title}</span>{#if projects.length > 1}<small>{projectName(item.project)}</small>{/if}</li>{/each}
          </ul></details>
        {/if}
        {#if !day.released.length && !day.completed.length && !day.checked.length && !day.other.length}<p class="empty">当天没有记录。</p>{/if}
      </details>
    {/each}
  </div>
{/if}
