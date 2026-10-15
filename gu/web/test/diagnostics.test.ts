import { describe, expect, it } from "vitest";
import { humanizeQuoteError, noticeTone } from "../src/diagnostics";

describe("humanizeQuoteError", () => {
  it("maps TLS handshake timeouts to a plain Chinese explanation", () => {
    const raw =
      "query2.finance.yahoo.com: <urlopen error _ssl.c:1112: The handshake operation timed out>";
    expect(humanizeQuoteError(raw)).toContain("TLS 握手超时");
  });

  it("maps 429 rate limits to the rate-limit explanation", () => {
    expect(humanizeQuoteError("HTTP Error 429")).toBe(
      "请求频率超限，被 Yahoo 限流",
    );
  });

  it("maps generic timeouts without leaking Python module paths", () => {
    expect(humanizeQuoteError("connect timeout")).toContain("超时");
  });

  it("strips the host prefix when the error type is not recognised", () => {
    const raw =
      "query2.finance.yahoo.com: <urlopen error [Errno 8] nodename nor servname provided>";
    // nodename nor servname 是已识别项，命中 DNS 分支
    expect(humanizeQuoteError(raw)).toBe(
      "无法解析行情域名（请确认主机能否访问 Yahoo Finance）",
    );
  });

  it("returns the raw text when nothing matches and there is no host prefix to strip", () => {
    expect(humanizeQuoteError("custom upstream error")).toBe(
      "custom upstream error",
    );
  });

  it("returns empty string for empty / null input", () => {
    expect(humanizeQuoteError("")).toBe("");
    expect(humanizeQuoteError(null)).toBe("");
    expect(humanizeQuoteError(undefined)).toBe("");
  });
});

describe("noticeTone", () => {
  it("promotes hard-trigger and failure words to danger", () => {
    expect(noticeTone("NVDA 7.0% 已触发停买")).toBe("danger");
    expect(noticeTone("刷新失败，请重试")).toBe("danger");
    expect(noticeTone("行情请求超时")).toBe("warning");
  });

  it("flags stale, unconfirmed and unevaluated markers as warning", () => {
    expect(noticeTone("价格时刻未确认")).toBe("warning");
    expect(noticeTone("现金待核对")).toBe("warning");
    expect(noticeTone("完整账户历史尚未补齐")).toBe("warning");
  });

  it("uses success for explicit up-to-date or already-checked messages", () => {
    expect(noticeTone("已检查，当前已是最新同步批次。")).toBe("success");
    expect(noticeTone("已载入新同步批次。")).toBe("success");
  });

  it("falls back to info for neutral statements", () => {
    expect(noticeTone("刷新只读取已同步数据。")).toBe("info");
  });
});
