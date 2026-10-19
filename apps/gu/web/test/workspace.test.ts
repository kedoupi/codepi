import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import { emptyWorkspace, type WorkspaceData } from "../../worker/workspace-types";
import { goTo, mountApp, resetClientState, stubFetch } from "./helpers";
import { session } from "../src/lib/state.svelte";

function fixture() {
  const data = emptyWorkspace();
  data.account.name = "合成在线账户";
  data.account.confirmed_on = "2026-10-01";
  data.rules.body = "合成测试规则";
  return data;
}
function stub(active = true, initial = fixture()) {
  let revision = active ? 1 : 0, data = initial, expired = false, conflict = false, loseResponse = false;
  const saved: unknown[] = [];
  const requests = new Map<string, number>();
  const view = () => ({ active: revision > 0, revision, updated_at: "2026-10-01T00:00:00Z", data,
    materials_enabled: true, valuation: { total_usd: null, known_usd: "0", missing: 0,
      entries: 0, oldest_date: null, warnings: ["尚无账户估值"] } });
  const mock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(input), method = init?.method || "GET";
    if (path === "/api/health") return Response.json({ sso_enabled: true });
    if (path === "/api/auth/logout") return Response.json({ ok: true });
    if (expired) return Response.json({ error: "登录过期" }, { status: 401 });
    if (path === "/api/me") return Response.json({ authenticated: true });
    if (path === "/api/dashboard") return revision
      ? Response.json({ mode: "online", workspace: view() })
      : Response.json({ error: "尚未同步数据" }, { status: 404 });
    if (path === "/api/workspace" && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      saved.push(body);
      if (conflict) return Response.json({ error: "版本冲突，草稿仍保留" }, { status: 409 });
      if (!requests.has(body.request_id)) {
        data = body.data; revision++;
        requests.set(body.request_id, revision);
      }
      if (loseResponse) { loseResponse = false; throw new TypeError("Synthetic lost response"); }
      return Response.json({ ...view(), saved_revision: requests.get(body.request_id) });
    }
    if (path === "/api/workspace") return Response.json(view());
    if (path === "/api/workspace/preview") return Response.json({
      data: JSON.parse(String(init?.body)).data, valuation: view().valuation,
    });
    if (path === "/api/workspace/history") return Response.json({ versions: [{ revision, created_at: "2026-10-01T00:00:00Z" }] });
    if (path === "/api/materials") return Response.json({ enabled: true, materials: [] });
    throw new Error(`Unhandled request ${path}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, saved, expire: () => expired = true, conflict: () => conflict = true,
    loseNextResponse: () => loseResponse = true };
}
beforeEach(resetClientState);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ready() {
  await screen.findByDisplayValue("合成在线账户");
  await vi.waitFor(() => expect(document.querySelector("fieldset")?.disabled).toBe(false));
}

describe("online workspace journey", () => {
  it("can create the first online account without a legacy dashboard", async () => {
    const backend = stub(false);
    await mountApp("#workspace");
    await ready();
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "新线上账户" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    expect(backend.saved).toHaveLength(0);
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本 1/);
    expect(backend.saved).toHaveLength(1);
    expect(session.online?.data.account.name).toBe("新线上账户");
    expect(session.snapshot).toBeNull();
    expect(session.notice).toBe("");
    expect(screen.queryByText("尚未同步数据")).toBeNull();
  });
  it("preserves a draft across sections and requires preview before writing", async () => {
    const backend = stub();
    await mountApp();
    await ready();
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "未保存账户" } });
    await goTo("#rules");
    await screen.findByDisplayValue("合成测试规则");
    await fireEvent.input(screen.getByLabelText("规则正文（Markdown）"), { target: { value: "新的测试规则" } });
    await goTo("#workspace");
    expect(screen.getByDisplayValue("未保存账户")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    expect(backend.saved).toHaveLength(0);
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本 2/);
    expect(backend.saved[0]).toMatchObject({ confirmed: true, base_revision: 1,
      data: { account: { name: "未保存账户" }, rules: { body: "新的测试规则" } } });
  });
  it("retains the draft on conflicts without advancing the base revision", async () => {
    const backend = stub();
    await mountApp("#workspace");
    await ready();
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "冲突草稿" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    backend.conflict();
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText("版本冲突，草稿仍保留");
    await fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByDisplayValue("冲突草稿")).toBeTruthy();
    expect(session.online?.revision).toBe(1);
  });
  it("retries a lost save response with the same request id and base revision", async () => {
    const backend = stub();
    await mountApp("#workspace");
    await ready();
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "请求重试草稿" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    backend.loseNextResponse();
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText("Synthetic lost response");
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本 2/);
    expect(backend.saved).toHaveLength(2);
    expect(backend.saved[0]).toEqual(backend.saved[1]);
    expect(session.online?.revision).toBe(2);
  });
  it("requires confirmation before discarding a draft on explicit logout", async () => {
    const backend = stub();
    const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
    await mountApp("#workspace");
    await ready();
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "退出前的草稿" } });
    await fireEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByDisplayValue("退出前的草稿")).toBeTruthy();
    expect(backend.mock.mock.calls.some(([url]) => url === "/api/auth/logout")).toBe(false);
    confirm.mockReturnValue(true);
    await fireEvent.click(screen.getByRole("button", { name: "退出" }));
    await screen.findByText("统一登录");
    expect(session.workspaceDirty).toBe(false);
  });
  it("returns to the legacy dashboard before activation with a draft discard guard", async () => {
    const backend = stubFetch({ sso: true });
    backend.setHandler(path => {
      if (path === "/api/workspace") return Response.json({ active: false, revision: 0, data: emptyWorkspace(),
        updated_at: null, materials_enabled: false, valuation: { total_usd: null, known_usd: "0", missing: 0,
          entries: 0, oldest_date: null, warnings: [] } });
      if (path === "/api/materials") return Response.json({ enabled: false, materials: [] });
      if (path === "/api/workspace/history") return Response.json({ versions: [] });
    });
    const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
    await mountApp();
    await screen.findByText("估算总资产 · 美元");
    await goTo("#workspace");
    await screen.findByLabelText("账户名称");
    await vi.waitFor(() => expect(document.querySelector("fieldset")?.disabled).toBe(false));
    await fireEvent.input(screen.getByLabelText("账户名称"), { target: { value: "切换前的草稿" } });
    await goTo("#overview");
    expect(confirm).toHaveBeenCalled();
    expect(location.hash).toBe("#workspace");
    expect(screen.getByDisplayValue("切换前的草稿")).toBeTruthy();
    confirm.mockReturnValue(true);
    await goTo("#overview");
    await screen.findByText("估算总资产 · 美元");
    expect(session.workspaceOpen).toBe(false);
    expect(session.workspaceDirty).toBe(false);
    expect(screen.queryByLabelText("账户名称")).toBeNull();
  });
  it("leaves a new report's basis unknown until the author chooses a saved version", async () => {
    const backend = stub();
    await mountApp("#rules");
    await screen.findByDisplayValue("合成测试规则");
    await vi.waitFor(() => expect(document.querySelector("fieldset")?.disabled).toBe(false));
    await fireEvent.input(screen.getByLabelText("规则正文（Markdown）"), { target: { value: "未保存的新规则" } });
    await goTo("#reports");
    await fireEvent.click(screen.getByRole("button", { name: "新建报告" }));
    await fireEvent.input(screen.getByLabelText("报告标题"), { target: { value: "依据草稿撰写" } });
    await fireEvent.input(screen.getByLabelText("正文（Markdown）"), { target: { value: "依据未保存规则的合成报告。" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本 2/);
    expect((backend.saved[0] as { data: WorkspaceData }).data.reports[0].based_on_revision).toBeNull();
    await fireEvent.change(screen.getByLabelText("依据工作台版本"), { target: { value: "2" } });
    await fireEvent.input(screen.getByLabelText("对应交易日"), { target: { value: "2026-10-01" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本 3/);
    expect((backend.saved[1] as { data: WorkspaceData }).data.reports[0]).toMatchObject({
      based_on_revision: 2, trading_date: "2026-10-01", date_source: "manual",
    });
  });
  it("can reimport a valid large draft exported with formatting overhead", async () => {
    const data = fixture();
    data.account.trades = Array.from({ length: 2000 }, (_, i) => ({ id: `trade-${i}`, date: "2026-10-01",
      account: "", kind: "fee", symbol: "", currency: "USD", quantity: null, amount: "0", note: "" }));
    data.reports = Array.from({ length: 3 }, (_, i) => ({ id: `report-${i}`, title: "合成报告", date: "2026-10-01",
      trading_date: null, date_source: "", kind: "note", summary: "", body: "x".repeat(380000), source: "", based_on_revision: null }));
    const backend = stub(true, data);
    let exported: Blob | undefined;
    vi.stubGlobal("URL", Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => { exported = blob; return "blob:synthetic"; }),
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await mountApp("#status");
    await screen.findByLabelText("导入 GU 工作台 JSON");
    await vi.waitFor(() => expect(document.querySelector("fieldset")?.disabled).toBe(false));
    await fireEvent.click(screen.getByRole("button", { name: "导出草稿" }));
    expect(exported!.size).toBeGreaterThan(1_600_000);
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exported!);
    });
    const file = new File([content], "gu-draft.json", { type: "application/json" });
    // jsdom's File lacks the browser File.text() method.
    Object.defineProperty(file, "text", { value: async () => content });
    await fireEvent.change(screen.getByLabelText("导入 GU 工作台 JSON"), { target: {
      files: [file],
    } });
    await screen.findByText(/已载入导入草稿/);
    expect(backend.saved).toHaveLength(0);
    expect(backend.mock.mock.calls.some(([url]) => url === "/api/workspace/preview")).toBe(true);
  });
  it("clears online values and unsaved private text after a revoked session", async () => {
    const backend = stub();
    await mountApp("#rules");
    await screen.findByDisplayValue("合成测试规则");
    backend.expire();
    window.dispatchEvent(new Event("focus"));
    await screen.findByText("统一登录");
    expect(session.online).toBeNull();
    expect(document.body.textContent).not.toContain("合成测试规则");
    expect(document.body.textContent).not.toContain("合成在线账户");
  });
  it("keeps unsigned and failed reads out of the editor", async () => {
    const backend = stub(); backend.expire();
    await mountApp("#workspace");
    await screen.findByText("统一登录");
    expect(screen.queryByLabelText("账户名称")).toBeNull();
  });
  it("keeps the local OTP pattern literal so a six-digit code can be submitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/health"
      ? Response.json({ sso_enabled: false }) : Response.json({ error: "login required" }, { status: 401 })));
    await mountApp("#workspace");
    await screen.findByText("发送验证码");
    const input = screen.getByLabelText("六位验证码") as HTMLInputElement;
    expect(input.getAttribute("pattern")).toBe("[0-9]{6}");
    await fireEvent.input(input, { target: { value: "123456" } });
    expect(input.checkValidity()).toBe(true);
  });
  it("treats blank optional values as unknown rather than zero", async () => {
    const backend = stub();
    await mountApp("#workspace");
    await ready();
    await fireEvent.click(screen.getByRole("button", { name: "添加余额" }));
    await fireEvent.input(screen.getByLabelText("余额名称"), { target: { value: "未核实余额" } });
    await fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    await screen.findByRole("button", { name: "确认保存到线上" });
    await fireEvent.click(screen.getByRole("button", { name: "确认保存到线上" }));
    await screen.findByText(/已保存线上版本/);
    const payload = backend.saved[0] as { data: WorkspaceData };
    expect(payload.data.account.cash[0]).toMatchObject({ amount: null, currency: null, value_usd: null });
  });
});
