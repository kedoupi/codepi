import { describe, expect, it } from "vitest";
import { canMarkBoxed, canReview, canSubmit, canWithdraw, reviewNextStatus } from "../worker/status";

describe("status machine", () => {
  it("maps review actions", () => {
    expect(reviewNextStatus("过")).toBe("可推箱");
    expect(reviewNextStatus("要改")).toBe("需改");
    expect(reviewNextStatus("拒")).toBe("draft");
  });

  it("only allows review from 待审", () => {
    expect(canReview("待审")).toBe(true);
    expect(canReview("需改")).toBe(false);
    expect(canReview("可推箱")).toBe(false);
  });

  it("allows resubmit from draft/需改 and boxed only from 可推箱", () => {
    expect(canSubmit("draft")).toBe(true);
    expect(canSubmit("需改")).toBe(true);
    expect(canSubmit("可推箱")).toBe(false);
    expect(canMarkBoxed("可推箱")).toBe(true);
    expect(canMarkBoxed("待审")).toBe(false);
  });

  it("allows withdraw to 待审 from 需改 / 可推箱 / 已进箱 only", () => {
    expect(canWithdraw("需改")).toBe(true);
    expect(canWithdraw("可推箱")).toBe(true);
    expect(canWithdraw("已进箱")).toBe(true);
    expect(canWithdraw("待审")).toBe(false);
    expect(canWithdraw("draft")).toBe(false);
  });
});
