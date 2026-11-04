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

const STATUS: Record<string, string> = { decide: "待决定", doing: "执行", bug: "缺陷", verify: "待确认", idea: "想法" };
const NEED: Record<string, string> = { decide: "决定", attend: "到场", authorize: "授权", confirm: "确认", none: "" };

function taskLine(value: unknown): string | null {
  const task = object(value);
  if (!task) return null;
  const need = NEED[text(task.need_kind) ?? "none"] ?? "";
  const due = text(task.due);
  const done = text(task.done_at);
  return `  ${done ? "✓ " : ""}${due ? `${due} ` : ""}${need ? `[${need}] ` : ""}${text(task.title) ?? "task"}` +
    `  (${text(task.project) ?? ""}/${text(task.key) ?? ""}${done ? "" : `, ${STATUS[text(task.status) ?? ""] ?? text(task.status) ?? ""}`})`;
}

function section(lines: string[], title: string, items: unknown[]): void {
  if (!items.length) return;
  lines.push("", title);
  for (const item of items) {
    const line = taskLine(item);
    if (line) lines.push(line);
  }
}

export function renderOverview(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const counts = object(root.counts);
  const lines = [`今天 ${text(root.today) ?? ""}：需要你 ${counts?.need_you ?? 0} · 逾期 ${counts?.overdue ?? 0} · ` +
    `7 天内到期 ${counts?.due_7d ?? 0} · 未完成 ${counts?.open ?? 0} · 进行中分支 ${counts?.branches ?? 0}`];
  section(lines, "需要你：", list(root.need_you));
  section(lines, "7 天内到期：", list(root.due_soon));
  section(lines, "最近 7 天完成：", list(root.recently_done));
  const branches = list(root.branches).map(object).filter(Boolean) as JsonObject[];
  if (branches.length) {
    lines.push("", "进行中分支：");
    for (const branch of branches) lines.push(`  ${text(branch.project)}: ${text(branch.name)} (+${branch.ahead ?? 0})`);
  }
  const truncated = list(root.truncated);
  if (truncated.length) lines.push("", `部分列表已截短：${truncated.join(", ")}；用 codepi tasks 看全部。`);
  return lines.join("\n");
}

export function renderProjectList(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const lines: string[] = [];
  for (const item of list(root.projects)) {
    const project = object(item);
    if (!project) continue;
    const name = text(project.name) ?? text(project.id) ?? "project";
    lines.push(`${name} (${text(project.id) ?? ""}${text(project.repo) ? `, ${text(project.repo)}` : ""}) [${text(project.status) ?? "unknown"}]`);
    lines.push(`  ${project.open ?? 0} 条未完成 · ${project.need_you ?? 0} 条需要你 · ${project.branches ?? 0} 个分支 · 最近推送 ${text(project.last_push_at) ?? "从未"}`);
    if (text(project.url)) lines.push(`  ${text(project.url)}`);
  }
  return lines.join("\n") || "没有项目";
}

export function renderTasks(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const lines: string[] = [];
  for (const item of list(root.tasks)) {
    const line = taskLine(item);
    if (line) lines.push(line.trimStart());
  }
  return lines.join("\n") || "没有待办";
}

export function renderProjectCard(value: unknown): string {
  const root = object(value);
  if (!root) return renderFallback(value);
  const project = object(root.project);
  const adapter = object(project?.adapter);
  const name = text(project?.name) ?? text(project?.id) ?? "project";
  const repo = text(project?.repo);
  const lines = [`${name}${repo ? ` (${repo})` : ""}${text(project?.status) ? ` [${text(project?.status)}]` : ""}`];
  if (text(project?.url)) lines.push(text(project?.url) as string);
  lines.push(`最近推送：${text(project?.last_push_at) ?? "从未"}${text(project?.source_sha) ? ` @ ${text(project?.source_sha)}` : ""}`);
  if (text(project?.rules_path)) lines.push(`规则入口：${text(project?.rules_path)}`);
  if (adapter) {
    if (text(adapter.isolation)) lines.push(`隔离：${text(adapter.isolation)}`);
    if (text(adapter.commit)) lines.push(`提交：${text(adapter.commit)}`);
    const acceptance = list(adapter.acceptance).filter((item): item is string => typeof item === "string");
    if (acceptance.length) lines.push(`验收：${acceptance.join("；")}`);
    if (text(adapter.merge)) lines.push(`合并：${text(adapter.merge)}`);
  }
  const counts = object(root.counts);
  const byStatus = object(counts?.by_status);
  if (byStatus) {
    lines.push("", `待办：${Object.entries(STATUS).map(([key, label]) => `${label} ${byStatus[key] ?? 0}`).join(" · ")}` +
      ` · 需要你 ${counts?.need_you ?? 0}`);
  }
  const branches = list(root.branches).map(object).filter(Boolean) as JsonObject[];
  if (branches.length) {
    lines.push("", "进行中分支：");
    for (const branch of branches) lines.push(`  ${text(branch.name)} (+${branch.ahead ?? 0})`);
  }
  const handoffs = list(root.handoffs).map(object).filter(Boolean) as JsonObject[];
  if (handoffs.length) {
    lines.push("", "交接（每个任务最新一条）：");
    for (const handoff of handoffs) {
      lines.push(`  ${text(handoff.task)} [${text(handoff.status)}] ${text(handoff.client) ?? ""}`);
      if (text(handoff.next)) lines.push(`    next: ${text(handoff.next)}`);
    }
  } else {
    lines.push("", "还没有交接记录。");
  }
  const notice = text(root.notice);
  if (notice) lines.push("", notice);
  return lines.join("\n");
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
