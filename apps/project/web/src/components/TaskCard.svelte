<script lang="ts">
  import Icon from "./Icon.svelte";
  import { dueTone, monthDay, NEED_LABEL, projectSlot } from "../lib/format";
  import type { ProjectSummary, TaskBrief } from "../lib/types";

  let { task, today, projects, onOpen, showProject = true }: {
    task: TaskBrief;
    today: string;
    projects: ProjectSummary[];
    onOpen: (project: string, key: string) => void;
    showProject?: boolean;
  } = $props();
  const projectName = $derived(projects.find(project => project.id === task.project)?.name ?? task.project);
</script>

<button class={`card slot-${projectSlot(projects, task.project)}`} class:done={task.done_at}
  onclick={() => onOpen(task.project, task.key)}>
  <span class="card-title">{task.title}</span>
  <span class="chips">
    {#if task.done_at}
      <span class="chip ok"><Icon name="check" size={12} />完成</span>
    {:else if task.need_kind !== "none"}
      <span class="chip you"><Icon name={task.need_kind} size={12} />{NEED_LABEL[task.need_kind]}</span>
    {/if}
    {#if task.due && !task.done_at}
      <span class={`chip due ${dueTone(task.due, today)}`}><Icon name="clock" size={12} />{monthDay(task.due)}</span>
    {/if}
    <span class="card-meta">{showProject && projects.length > 1 ? `${projectName} · ` : ""}{task.category}</span>
  </span>
</button>
