import { describe, expect, it } from "vitest";
import { longDate, weekday } from "../src/lib/format";

describe("Today date formatting", () => {
  it("formats a fixed Beijing calendar date and weekday", () => {
    const date = "2026-11-06";
    expect(`${longDate(date)} · ${weekday(date)}`).toBe("11月6日 · 周五");
  });
});
