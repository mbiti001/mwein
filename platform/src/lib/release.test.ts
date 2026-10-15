import { describe, expect, it } from "vitest";
import { releaseIdentity } from "./release";

describe("release identity", () => {
  it("prefers the immutable Vercel git commit", () => {
    expect(releaseIdentity({ VERCEL_GIT_COMMIT_SHA: "1234567890abcdef", DEPLOYMENT_VERSION: "fallback" })).toMatchObject({ commit: "1234567890abcdef", shortCommit: "1234567890ab" });
  });
  it("falls back explicitly rather than inventing a release", () => {
    expect(releaseIdentity({ NODE_ENV: "test" })).toMatchObject({ commit: "local", environment: "test" });
  });
  it("identifies CLI builds and repeated deployments of the same source without disclosing unrelated configuration", () => {
    const environment = { DEPLOYMENT_VERSION: "a".repeat(40), RELEASE_BRANCH: "codex/release", VERCEL_ENV: "production", VERCEL_DEPLOYMENT_ID: "dpl_first", AUTH_SECRET: "must-not-be-exposed", DATABASE_URL: "must-not-be-exposed" };
    const first = releaseIdentity(environment);
    const second = releaseIdentity({ ...environment, VERCEL_DEPLOYMENT_ID: "dpl_second" });
    expect(first).toEqual({ application: "mwein-hmis-platform", commit: "a".repeat(40), shortCommit: "a".repeat(12), branch: "codex/release", deployment: "dpl_first", environment: "production" });
    expect(second.commit).toBe(first.commit);
    expect(second.deployment).not.toBe(first.deployment);
    expect(JSON.stringify(first)).not.toContain("must-not-be-exposed");
  });
});
