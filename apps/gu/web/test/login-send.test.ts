import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Login from "../src/components/Login.svelte";
import { session } from "../src/lib/state.svelte";
import * as api from "../src/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  session.ssoMode = undefined;
});

describe("OTP send", () => {
  it("coalesces repeated clicks while the first request is pending", async () => {
    session.ssoMode = false;
    let release!: (value: { retry_after: number }) => void;
    const request = vi.spyOn(api, "api").mockImplementation(() => new Promise(resolve => {
      release = resolve;
    }));
    render(Login, { onLoggedIn: async () => undefined });

    const button = screen.getByRole("button", { name: "发送验证码" });
    await fireEvent.click(button);
    await fireEvent.click(button);
    release({ retry_after: 60 });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith("/api/auth/request-otp", {});
  });
});
