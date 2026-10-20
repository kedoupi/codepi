import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import FieldCard from "../src/components/FieldCard.svelte";
import HandoffTimeline from "../src/components/HandoffTimeline.svelte";
import ProgressPanel from "../src/components/ProgressPanel.svelte";
import ProjectList from "../src/components/ProjectList.svelte";
import type { Handoff } from "../src/lib/types";

afterEach(cleanup);

function handoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: "handoff-1",
    task_id: "task-a",
    status: "in_progress",
    client: "Codex",
    summary: "Implemented the project card.",
    next: "Run the integration checks.",
    blockers: null,
    files: [],
    branch: "codex/task-a",
    base_sha: "abbafdfe2d04966d66dad2f4f0084075f040caaf",
    commit: null,
    pr: null,
    at: "2026-10-20T04:00:00Z",
    ...overrides,
  };
}

describe("project board components", () => {
  it("edits and resets an AGENTS.md card field", async () => {
    const onSave = vi.fn(async () => {});
    const onReset = vi.fn(async () => {});
    render(FieldCard, {
      props: {
        name: "goal",
        label: "目标",
        field: {
          value: "Edited value",
          auto_value: "New automatic value",
          source: "edited",
          agents_md_changed: true,
        },
        onSave,
        onReset,
      },
    });
    expect(screen.getByText("AGENTS.md 有更新")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "编辑目标" });
    await fireEvent.input(editor, { target: { value: "Next owner text" } });
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("goal", "Next owner text"));
    expect(onSave).toHaveBeenCalledTimes(1);

    render(FieldCard, {
      props: {
        name: "scope",
        label: "范围",
        field: { value: "Edited scope", auto_value: "Auto", source: "edited", agents_md_changed: false },
        onSave,
        onReset,
      },
    });
    await fireEvent.click(screen.getAllByRole("button", { name: "恢复自动提取" }).at(-1)!);
    await waitFor(() => expect(onReset).toHaveBeenCalledWith("scope"));
  });

  it("renders user text as text rather than executable HTML", async () => {
    const payload = "<script>window.__project_pwned = true</script>";
    const { container } = render(HandoffTimeline, {
      props: {
        handoffs: [handoff({ summary: payload })],
        hasMore: false,
        loading: false,
        onLoadMore: async () => {},
      },
    });
    expect(screen.getByText(payload)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __project_pwned?: boolean }).__project_pwned).toBeUndefined();
  });

  it("keeps duplicate file names from breaking the timeline key", () => {
    render(HandoffTimeline, {
      props: {
        handoffs: [handoff({ files: ["same.txt", "same.txt"] })],
        hasMore: false,
        loading: false,
        onLoadMore: async () => {},
      },
    });
    expect(screen.getAllByText("same.txt")).toHaveLength(2);
  });

  it("shows task-specific progress instead of only one global handoff", () => {
    render(ProgressPanel, {
      props: {
        repo: "kedoupi/kdp.cool",
        taskProgress: [
          { task_id: "task-a", status: "in_progress", latest: handoff() },
          {
            task_id: "task-b",
            status: "blocked",
            latest: handoff({ id: "handoff-2", task_id: "task-b", summary: "Task B summary" }),
          },
        ],
      },
    });
    expect(screen.getByText("task-a")).toBeTruthy();
    expect(screen.getByText("task-b")).toBeTruthy();
    expect(screen.getByText("Task B summary")).toBeTruthy();
  });

  it("shows an empty progress state and the project list next step", () => {
    render(ProgressPanel, { props: { repo: "kedoupi/kdp.cool", taskProgress: [] } });
    expect(screen.getByText("还没有任务交接")).toBeTruthy();
    cleanup();
    render(ProjectList, {
      props: {
        asOf: "2026-10-20T04:00:00Z",
        projects: [{
          id: "kedoupi-kdp-cool",
          repo: "kedoupi/kdp.cool",
          name: "kdp.cool",
          status: "active",
          last_activity_at: "2026-10-20T04:00:00Z",
          url: "https://project.codepi.app/p/kedoupi-kdp-cool",
          latest_handoff: handoff({ next: "Continue with the board." }),
        }],
        onOpen: vi.fn(),
      },
    });
    expect(screen.getByText(/Continue with the board/)).toBeTruthy();
    expect(screen.getByText("kdp.cool")).toBeTruthy();
  });
});
