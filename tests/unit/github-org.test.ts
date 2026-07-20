import { describe, it, expect } from "vitest";
import { makeGithubOrgCheck } from "../../api/src/shared/auth.js";

const fakeFetch = (status: number, jsonBody?: unknown) =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => jsonBody })) as unknown as typeof fetch;

describe("makeGithubOrgCheck", () => {
  it("org membership: 204 → member, 404 → not", async () => {
    expect(await makeGithubOrgCheck("t", "org", undefined, fakeFetch(204))("octocat")).toBe(true);
    expect(await makeGithubOrgCheck("t", "org", undefined, fakeFetch(404))("stranger")).toBe(false);
  });
  it("team membership: active state → member", async () => {
    expect(await makeGithubOrgCheck("t", "org", "team", fakeFetch(200, { state: "active" }))("octocat")).toBe(true);
    expect(await makeGithubOrgCheck("t", "org", "team", fakeFetch(200, { state: "pending" }))("octocat")).toBe(false);
  });
  it("fails closed on empty inputs and network errors", async () => {
    expect(await makeGithubOrgCheck("t", "org", undefined, fakeFetch(204))("")).toBe(false);
    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect(await makeGithubOrgCheck("t", "org", undefined, boom)("octocat")).toBe(false);
  });
});
