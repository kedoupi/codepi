import { assertKeys, object, requiredText, normalizeTags, validateMemoryKind, validateTimelineKind,
  validateDatePart, looksSecret, ValidationError, optionalText, AppError } from "./lib";
import type { MemoryKind } from "./models";
import type { TimelineInput } from "./data";

export function inputObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (!object(input)) throw new ValidationError("需要对象参数");
  assertKeys(input, keys);
  return input;
}

export function noSecrets(...values: (string | null | string[])[]) {
  if (values.flat().some(value => value && looksSecret(value))) {
    throw new AppError("secret_detected", 400, "检测到疑似密钥；请移除后重试。内容未保存。");
  }
}

export function memoryInput(input: unknown, defaultKind = false): { text: string; kind: MemoryKind; tags: string[] } {
  const args = inputObject(input, ["text", "kind", "tags"]);
  if (("kind" in args && !args.kind) || ("tags" in args && !Array.isArray(args.tags))) {
    throw new ValidationError("记忆字段类型无效");
  }
  const text = requiredText(args.text, "记忆", 2000);
  const kind = validateMemoryKind(args.kind) ?? (defaultKind ? "note" : null);
  if (!kind) throw new ValidationError("需要记忆类型");
  const tags = normalizeTags(args.tags);
  noSecrets(text, tags);
  return { text, kind, tags };
}

export const timelineKeys = ["kind", "title", "org", "started_on", "ended_on", "body"];
export function timelineInput(input: unknown): TimelineInput {
  const args = inputObject(input, timelineKeys);
  const kind = validateTimelineKind(args.kind);
  if (!kind) throw new ValidationError("需要经历类型");
  const title = requiredText(args.title, "标题", 200);
  const org = optionalText(args.org, "组织", 200);
  const startedOn = validateDatePart(args.started_on, "开始日期");
  const endedOn = validateDatePart(args.ended_on, "结束日期");
  if (startedOn && endedOn && startedOn > endOf(endedOn)) throw new ValidationError("结束日期早于开始日期");
  const body = optionalText(args.body, "正文", 8000);
  noSecrets(title, org, body);
  return { kind, title, org, startedOn, endedOn, body };
}

export function endOf(date: string): string {
  return date.length === 4 ? `${date}-12-31` : date.length === 7
    ? `${date}-${new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5)), 0)).getUTCDate()}` : date;
}
