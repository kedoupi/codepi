import { describe, expect, it } from "vitest";
import {
  isReadComplete,
  pendingReviewActionsHtml,
  READ_DONE_LABEL,
  READ_GATE_SLACK_PX,
  READ_HINT,
  reviewActionsAreLocked,
  reviewDockLockClass,
} from "../web/src/read-gate";

describe("read-complete gate", () => {
  it("treats short content that fits the viewport as already read", () => {
    expect(
      isReadComplete({ scrollTop: 0, clientHeight: 800, scrollHeight: 400 }),
    ).toBe(true);
  });

  it("stays locked until the reader reaches the bottom slack", () => {
    expect(
      isReadComplete({ scrollTop: 0, clientHeight: 800, scrollHeight: 2000 }),
    ).toBe(false);
    expect(
      isReadComplete({
        scrollTop: 2000 - 800 - READ_GATE_SLACK_PX - 1,
        clientHeight: 800,
        scrollHeight: 2000,
      }),
    ).toBe(false);
    expect(
      isReadComplete({
        scrollTop: 2000 - 800 - READ_GATE_SLACK_PX,
        clientHeight: 800,
        scrollHeight: 2000,
      }),
    ).toBe(true);
  });
});

describe("pending review actions stay locked on entry", () => {
  it("renders 过/要改/拒 disabled with the 请先通读全文 hint", () => {
    const html = pendingReviewActionsHtml("kdp-0917-zao", true);
    expect(reviewActionsAreLocked(html)).toBe(true);
    expect(html).toContain(READ_HINT);
    expect(html).toContain(READ_DONE_LABEL);
    expect(html).toMatch(/data-review="过"[^>]*disabled/);
    expect(html).toMatch(/data-review="要改"[^>]*disabled/);
    expect(html).toMatch(/data-review="拒"[^>]*disabled/);
  });

  it("unlocks markup by dropping disabled on the three actions", () => {
    const html = pendingReviewActionsHtml("kdp-0917-zao", false);
    expect(html).toContain('data-review="过"');
    expect(html).not.toMatch(/data-review="过"[^>]*disabled/);
    expect(html).not.toMatch(/data-review="要改"[^>]*disabled/);
    expect(html).not.toMatch(/data-review="拒"[^>]*disabled/);
  });

  it("uses is-locked until read-complete, and has-manual-unlock only as the iframe equivalent gate", () => {
    expect(reviewDockLockClass({ locked: true, allowManualUnlock: false })).toBe(
      "dock dock-review is-locked",
    );
    expect(reviewDockLockClass({ locked: true, allowManualUnlock: true })).toBe(
      "dock dock-review is-locked has-manual-unlock",
    );
    expect(reviewDockLockClass({ locked: false, allowManualUnlock: true })).toBe("dock dock-review");
  });
});
