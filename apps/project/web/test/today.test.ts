// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Today from "../src/components/Today.svelte";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Today migration notice", () => {
  it("renders the Feishu migration notice without requesting today APIs", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(Today);
    expect(screen.getByRole("heading", { name: "今天/池子已迁到飞书清单「建国工作台」" })).toBeTruthy();
    expect(screen.getByText(/开窗请读本地「要办」队列和收件箱/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
