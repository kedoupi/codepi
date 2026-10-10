import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeBoard, parseReviewBody } from "../src/board.js";

const staticBoard = {
  updated: "2026-09-16",
  base: "https://gzh-preview.kdp.cool",
  articles: [
    {
      id: "demo-1",
      slot: "早",
      title: "示例稿",
      url: "https://gzh-preview.kdp.cool/demo-1/",
      status: "待审",
      note: "",
    },
    {
      id: "demo-2",
      slot: "晚",
      title: "已进箱稿",
      url: "https://gzh-preview.kdp.cool/demo-2/",
      status: "已进箱",
      note: "终稿",
    },
  ],
};

describe("mergeBoard", () => {
  it("用 KV 覆盖 status 和 note，保留静态 title/url/slot", () => {
    const merged = mergeBoard(staticBoard, {
      "demo-1": { status: "可推箱", note: "过了" },
    });
    assert.equal(merged.articles[0].status, "可推箱");
    assert.equal(merged.articles[0].note, "过了");
    assert.equal(merged.articles[0].title, "示例稿");
    assert.equal(merged.articles[0].url, "https://gzh-preview.kdp.cool/demo-1/");
    assert.equal(merged.articles[1].status, "已进箱");
  });
});

describe("parseReviewBody", () => {
  const ids = new Set(["demo-1"]);

  it("过 → 可推箱", () => {
    const { review } = parseReviewBody({ id: "demo-1", action: "过" }, ids);
    assert.equal(review.status, "可推箱");
  });

  it("要改 / 拒 → 需改，并保留备注", () => {
    const a = parseReviewBody({ id: "demo-1", action: "要改", note: "标题弱" }, ids);
    const b = parseReviewBody({ id: "demo-1", action: "拒", note: "事实错" }, ids);
    assert.equal(a.review.status, "需改");
    assert.equal(a.review.note, "标题弱");
    assert.equal(b.review.status, "需改");
  });

  it("拒绝未知文章和非法状态", () => {
    assert.equal(parseReviewBody({ id: "nope", action: "过" }, ids).error, "文章不在 board 中");
    assert.equal(parseReviewBody({ id: "demo-1", status: "已进草稿箱" }, ids).error, "status 仅支持 待审 / 需改 / 可推箱 / 已进箱");
  });
});
