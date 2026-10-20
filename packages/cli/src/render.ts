type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function renderContext(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const lines: string[] = [];
  const owner = object(root.owner);
  const brand = text(owner?.brand);
  const asOf = text(root.as_of);
  if (brand) lines.push(brand);
  if (asOf) lines.push(`As of: ${asOf}`);
  for (const item of list(root.sources)) {
    const source = object(item);
    if (!source) continue;
    const title = text(source.title) ?? text(source.id) ?? "source";
    const summary = object(source.summary);
    const status = text(summary?.status) ?? "unknown";
    lines.push("", `${title} [${status}]`);
    if (text(summary?.asOf) ?? text(summary?.as_of)) {
      lines.push(`  as of: ${text(summary?.asOf) ?? text(summary?.as_of)}`);
    }
    for (const fact of list(summary?.facts)) {
      if (typeof fact === "string") lines.push(`  - ${fact}`);
    }
    for (const metric of list(summary?.metrics)) {
      const entry = object(metric);
      if (entry && text(entry.label) && text(entry.value)) {
        lines.push(`  ${entry.label}: ${entry.value}`);
      }
    }
    for (const note of list(summary?.notes)) {
      if (typeof note === "string") lines.push(`  note: ${note}`);
    }
    for (const attention of list(summary?.attention)) {
      const entry = object(attention);
      if (entry && text(entry.label)) lines.push(`  attention: ${entry.label}`);
      else if (typeof attention === "string") lines.push(`  attention: ${attention}`);
    }
    const tools = list(source.next_tools).filter((tool): tool is string => typeof tool === "string");
    if (tools.length) lines.push(`  next: ${tools.join(", ")}`);
  }
  return lines.join("\n") || renderFallback(value);
}

export function renderProjectList(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const lines: string[] = [];
  for (const item of list(root.projects)) {
    const project = object(item);
    if (!project) continue;
    const name = text(project.name) ?? text(project.id) ?? "project";
    const repo = text(project.repo) ?? "";
    const status = text(project.status) ?? "unknown";
    lines.push(`${name} (${repo}) [${status}]`);
    const url = text(project.url);
    if (url) lines.push(`  ${url}`);
    const latest = object(project.latest_handoff) ?? object(project.latest);
    const taskId = text(latest?.task_id) ?? text(project.task_id);
    const taskStatus = text(latest?.status) ?? text(project.handoff_status);
    const next = text(latest?.next) ?? text(project.next);
    if (taskId || taskStatus || next) {
      lines.push(`  latest: ${taskId ?? "unknown"}${taskStatus ? ` [${taskStatus}]` : ""}`);
      if (next) lines.push(`  next: ${next}`);
    }
  }
  return lines.join("\n") || renderFallback(value);
}

export function renderProjectCard(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const project = object(root.project);
  const name = text(project?.name) ?? text(project?.id) ?? "project";
  const repo = text(project?.repo);
  const status = text(project?.status);
  const lines = [`${name}${repo ? ` (${repo})` : ""}${status ? ` [${status}]` : ""}`];
  if (text(project?.url)) lines.push(text(project?.url) as string);
  if (text(root.as_of)) lines.push(`As of: ${text(root.as_of)}`);
  for (const field of ["goal", "scope", "conventions", "pitfalls"]) {
    const entry = object(root[field]);
    const content = text(entry?.value);
    if (content) lines.push("", `${field}:`, content);
  }
  const tasks = list(root.task_progress);
  if (tasks.length > 0) {
    lines.push("", "Task progress:");
    for (const item of tasks) {
      const task = object(item);
      const latest = object(task?.latest);
      const taskId = text(task?.task_id) ?? text(latest?.task_id) ?? "unknown";
      const taskStatus = text(task?.status) ?? text(latest?.status) ?? "unknown";
      lines.push(`  ${taskId} [${taskStatus}]`);
      if (latest) appendHandoff(lines, latest, "    ");
    }
  } else if (object(root.progress)) {
    const progress = object(root.progress);
    lines.push("", "Latest handoff:");
    if (progress) appendHandoff(lines, progress, "  ");
  } else {
    lines.push("", "还没有交接记录。");
  }
  const notice = text(root.notice);
  if (notice) lines.push("", notice);
  return lines.join("\n");
}

function appendHandoff(lines: string[], handoff: JsonObject, indent: string): void {
  for (const field of ["summary", "next", "blockers", "branch", "base_sha", "commit", "pr", "client"]) {
    const value = text(handoff[field]);
    if (value) lines.push(`${indent}${field}: ${value}`);
  }
}

export function renderHandoff(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const lines = ["交接已写入。"];
  if (text(root.id)) lines.push(`id: ${text(root.id)}`);
  if (text(root.created_at)) lines.push(`created: ${text(root.created_at)}`);
  if (text(root.url)) lines.push(text(root.url) as string);
  return lines.join("\n");
}

export function renderFallback(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function toJsonOutput(result: { structured: unknown; text: string | null }): string {
  if (result.structured !== undefined && result.structured !== null) {
    return JSON.stringify(result.structured, null, 2);
  }
  if (result.text !== null) {
    try {
      JSON.parse(result.text);
      return result.text;
    } catch {
      return JSON.stringify(result.text);
    }
  }
  return "null";
}
