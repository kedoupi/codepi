import { describe, expect, it } from "vitest";
import { today } from "../worker/lib";

describe("calendar helpers", () => {
  it("uses the Beijing date boundary", () => {
    expect(today(new Date("2026-11-06T15:59:59Z"))).toBe("2026-11-06");
    expect(today(new Date("2026-11-06T16:00:00Z"))).toBe("2026-11-07");
    expect(today(new Date("2026-11-06T14:28:00Z"))).toBe("2026-11-06");
  });
});
