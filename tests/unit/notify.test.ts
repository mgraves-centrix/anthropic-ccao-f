import { describe, it, expect } from "vitest";
import { notify } from "../../api/src/shared/notify.js";

describe("notify", () => {
  it("posts a text payload + meta to the webhook", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fake = (async (url: string, opts: { body: string }) => {
      captured = { url, body: JSON.parse(opts.body) }; return { ok: true };
    }) as unknown as typeof fetch;
    await notify("https://hooks.example/x", { event: "access.request", text: "New request", meta: { email: "a@b.com" } }, fake);
    expect(captured!.url).toContain("hooks.example");
    expect(captured!.body.text).toBe("New request");
    expect(captured!.body.email).toBe("a@b.com");
  });

  it("no webhook → no-op; network errors are swallowed", async () => {
    await expect(notify(undefined, { event: "x", text: "y" })).resolves.toBeUndefined();
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(notify("https://x", { event: "x", text: "y" }, boom)).resolves.toBeUndefined();
  });
});
