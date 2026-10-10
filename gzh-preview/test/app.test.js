import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesFilter, previewUrl, qrImgUrl } from "../public/app.js";

describe("home filter", () => {
  const pending = { id: "a", slot: "", status: "待审" };
  const morning = { id: "b", slot: "早", status: "可推箱" };

  it("默认待审队列只看 status", () => {
    assert.equal(matchesFilter(pending, "待审"), true);
    assert.equal(matchesFilter(morning, "待审"), false);
    assert.equal(matchesFilter(morning, "早"), true);
    assert.equal(matchesFilter(pending, "全部"), true);
  });

  it("预览走 Pages，二维码指向 board url", () => {
    const article = { id: "2026-09-16-xiaotaozi", url: "https://gzh-preview.kdp.cool/2026-09-16-xiaotaozi/" };
    assert.equal(previewUrl(article), "https://gzh-preview.pages.dev/2026-09-16-xiaotaozi/");
    assert.match(qrImgUrl(article.url), /gzh-preview\.kdp\.cool/);
  });
});
