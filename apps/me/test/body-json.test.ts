import { expect, it } from "vitest";
import { bodyJson } from "../worker/lib";

it("accepts case-insensitive JSON media types with charset", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "Application/JSON; charset=UTF-8" },
    body: JSON.stringify({ ok: true }),
  });

  await expect(bodyJson(request)).resolves.toEqual({ ok: true });
});
