import { CliError, EXIT, errorMessage } from "./errors.js";
import type { McpToolResult } from "./mcp.js";

export const PROJECT_CARD_PAGINATION_FORMAT = "project_card_json_v1";
export const MAX_PROJECT_CARD_PAGES = 128;
export const MAX_PROJECT_CARD_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_CARD_CHUNK_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;
type FetchPage = (cursor: string) => Promise<McpToolResult>;

interface Page {
  format: typeof PROJECT_CARD_PAGINATION_FORMAT;
  cursor: string | null;
  nextCursor: string | null;
  totalBytes: number;
  chunkBytes: number;
  chunk: string;
  complete: boolean;
}

/**
 * Follow lossless project-card chunks before returning anything to the
 * renderer. A partial chunk is never a valid project card.
 */
export async function expandProjectCardPages(
  first: McpToolResult,
  fetchPage: FetchPage,
  initialCursor: string | null = null,
): Promise<McpToolResult> {
  const firstRoot = object(first.structured);
  if (!firstRoot || !Object.hasOwn(firstRoot, "pagination")) return first;

  const chunks: string[] = [];
  const seenCursors = new Set<string>();
  let expectedCursor = initialCursor;
  let declaredTotal: number | null = null;
  let receivedBytes = 0;
  let result = first;

  for (let pageNumber = 1; pageNumber <= MAX_PROJECT_CARD_PAGES; pageNumber += 1) {
    const page = parsePage(object(result.structured)?.pagination);
    if (page.cursor !== expectedCursor) {
      throw invalidPage("分页游标不连续，项目卡可能已变化。");
    }
    if (page.chunkBytes !== Buffer.byteLength(page.chunk, "utf8")) {
      throw invalidPage("分页块字节数不一致。");
    }
    if (page.chunkBytes > MAX_PROJECT_CARD_CHUNK_BYTES) {
      throw invalidPage("单个项目卡分页块过大。");
    }
    if (declaredTotal === null) {
      if (page.totalBytes <= 0 || page.totalBytes > MAX_PROJECT_CARD_BYTES) {
        throw invalidPage("项目卡总字节数超出安全上限。");
      }
      declaredTotal = page.totalBytes;
    } else if (page.totalBytes !== declaredTotal) {
      throw invalidPage("分页期间项目卡总字节数发生变化。");
    }

    receivedBytes += page.chunkBytes;
    if (receivedBytes > declaredTotal || receivedBytes > MAX_PROJECT_CARD_BYTES) {
      throw invalidPage("项目卡分页内容超出声明大小。");
    }
    chunks.push(page.chunk);

    if (page.complete) {
      if (page.nextCursor !== null) {
        throw invalidPage("已完成的分页仍包含后续游标。");
      }
      if (receivedBytes !== declaredTotal) {
        throw invalidPage("项目卡分页内容不完整。");
      }
      const canonical = chunks.join("");
      if (Buffer.byteLength(canonical, "utf8") !== declaredTotal) {
        throw invalidPage("项目卡拼接后的 UTF-8 字节数与 total_bytes 不一致。");
      }
      let card: unknown;
      try {
        card = JSON.parse(canonical);
      } catch {
        throw initialCursor === null
          ? invalidPage("项目卡分页不是完整 JSON。")
          : cursorRestartError("--cursor 指向项目卡中段，不能还原完整卡片。");
      }
      if (!object(card)) throw invalidPage("项目卡 JSON 顶层必须是对象。");
      return { structured: card, text: canonical };
    }

    if (page.nextCursor === null) {
      throw invalidPage("项目卡分页尚未完成，但缺少 next_cursor。");
    }
    if (page.nextCursor.length === 0 || page.nextCursor.length > 2048) {
      throw invalidPage("next_cursor 长度无效。");
    }
    if (seenCursors.has(page.nextCursor) || page.nextCursor === expectedCursor) {
      throw invalidPage("项目卡分页游标重复。");
    }
    if (pageNumber === MAX_PROJECT_CARD_PAGES) {
      throw invalidPage("项目卡分页页数超出安全上限。");
    }
    seenCursors.add(page.nextCursor);
    expectedCursor = page.nextCursor;
    try {
      result = await fetchPage(expectedCursor);
    } catch (error) {
      throw projectCardError(error);
    }
  }

  throw invalidPage("项目卡分页页数超出安全上限。");
}

export function projectCardError(error: unknown): unknown {
  const message = errorMessage(error);
  if (/\bcursor_stale\b|\binvalid_cursor\b/.test(message)) {
    return cursorRestartError("项目卡在分页期间发生变化，请重新运行 `codepi project`。");
  }
  return error;
}

function cursorRestartError(message: string): CliError {
  return new CliError(`${message} 旧项目卡分页游标已失效。`, EXIT.REMOTE, {
    code: "project_card_cursor_stale",
  });
}

function invalidPage(message: string): CliError {
  return new CliError(message, EXIT.REMOTE, { code: "project_card_pagination_invalid" });
}

function parsePage(value: unknown): Page {
  const raw = object(value);
  if (!raw) throw invalidPage("项目卡分页响应缺少 pagination。");
  if (raw.format !== PROJECT_CARD_PAGINATION_FORMAT) {
    throw invalidPage("项目卡分页格式不受支持。");
  }
  if (raw.encoding !== undefined && raw.encoding !== "utf-8") {
    throw invalidPage("项目卡分页编码不受支持。");
  }
  if (raw.cursor !== null && typeof raw.cursor !== "string") {
    throw invalidPage("pagination.cursor 类型无效。");
  }
  if (raw.next_cursor !== null && typeof raw.next_cursor !== "string") {
    throw invalidPage("pagination.next_cursor 类型无效。");
  }
  if (!Number.isSafeInteger(raw.total_bytes) || (raw.total_bytes as number) < 0) {
    throw invalidPage("pagination.total_bytes 类型无效。");
  }
  if (!Number.isSafeInteger(raw.chunk_bytes) || (raw.chunk_bytes as number) < 0) {
    throw invalidPage("pagination.chunk_bytes 类型无效。");
  }
  if (typeof raw.chunk !== "string" || typeof raw.complete !== "boolean") {
    throw invalidPage("项目卡分页字段类型无效。");
  }
  return {
    format: PROJECT_CARD_PAGINATION_FORMAT,
    cursor: raw.cursor,
    nextCursor: raw.next_cursor,
    totalBytes: raw.total_bytes as number,
    chunkBytes: raw.chunk_bytes as number,
    chunk: raw.chunk,
    complete: raw.complete,
  };
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
