import { describe, expect, it } from "vitest";
import markdown from "./fixtures/agents.md?raw";
import { extractCard } from "../worker/agents-md";

describe("AGENTS.md extraction", () => {
  it("extracts all four bounded fields from the repository fixture", () => {
    const card = extractCard(markdown);
    expect(card.goal).toBeTruthy();
    expect(card.scope).toBeTruthy();
    expect(card.conventions).toBeTruthy();
    expect(card.pitfalls).toBeTruthy();
    expect(Array.from(card.goal!).length).toBeLessThanOrEqual(800);
    expect(Array.from(card.scope!).length).toBeLessThanOrEqual(2000);
    expect(Array.from(card.conventions!).length).toBeLessThanOrEqual(2400);
    expect(Array.from(card.pitfalls!).length).toBeLessThanOrEqual(2400);
    expect(card.goal).toContain("personal digital space");
    expect(card.scope).toContain("apps/");
    expect(card.pitfalls).toContain(".npmrc");
  });

  it("returns null for missing sections and falls back to the H1 paragraph", () => {
    expect(extractCard("# Repo\n\nA short description.")).toEqual({
      goal: "A short description.",
      scope: null,
      conventions: null,
      pitfalls: null,
    });
  });
});
