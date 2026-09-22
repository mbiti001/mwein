import { describe, expect, it } from "vitest";
import { releaseIdentity } from "./release";

describe("release identity", () => {
  it("prefers the immutable Vercel git commit", () => {
    expect(releaseIdentity({ VERCEL_GIT_COMMIT_SHA: "1234567890abcdef", DEPLOYMENT_VERSION: "fallback" })).toMatchObject({ commit: "1234567890abcdef", shortCommit: "1234567890ab" });
  });
  it("falls back explicitly rather than inventing a release", () => {
    expect(releaseIdentity({ NODE_ENV: "test" })).toMatchObject({ commit: "local", environment: "test" });
  });
});
