import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import HandoffForm from "../src/components/HandoffForm.svelte";

afterEach(cleanup);

describe("HandoffForm", () => {
  it("does not submit again while the first submission is pending", async () => {
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveSubmit = resolve;
        }),
    );
    render(HandoffForm, { onSubmit });

    await fireEvent.input(screen.getByRole("textbox", { name: "任务 ID" }), {
      target: { value: "task-a" },
    });
    await fireEvent.input(screen.getByRole("textbox", { name: "分支" }), {
      target: { value: "codex/task-a" },
    });
    await fireEvent.input(screen.getByRole("textbox", { name: "完整基线 SHA" }), {
      target: { value: "abbafdfe2d04966d66dad2f4f0084075f040caaf" },
    });
    await fireEvent.input(screen.getByRole("textbox", { name: "这次做了什么" }), {
      target: { value: "Implemented the handoff form." },
    });
    await fireEvent.input(screen.getByRole("textbox", { name: "下一步" }), {
      target: { value: "Run the checks." },
    });

    const form = screen.getByRole("textbox", { name: "下一步" }).closest("form");
    expect(form).not.toBeNull();
    await fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "写入中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("textbox", { name: "任务 ID" }).matches(":disabled")).toBe(true);

    await fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit();
  });
});
