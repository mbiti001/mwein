import { describe, expect, it } from "vitest";
import { releaseIdentity } from "./release";
import ledger from "../../certification/releases/versions.json";
import packageMetadata from "../../package.json";
import lock from "../../package-lock.json";

describe("release identity", () => {
  it("binds the running version to the shared allocation and locked package", () => {
    const versions = ledger.releases.map(entry => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.every(version => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))).toBe(true);
    expect(versions.at(-1)).toBe(packageMetadata.version);
    expect(lock.version).toBe(packageMetadata.version);
    expect(lock.packages[""].version).toBe(packageMetadata.version);
    expect(releaseIdentity({ RELEASE_VERSION: "99.0.0" }).version).toBe(packageMetadata.version);
    expect(ledger.releases[0]).toMatchObject({ version: "1.0.0", displayName: "1", source: "1f9ce53871a81daeff1448b7b6fd04bc638d095c" });
  });
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
    expect(first).toEqual({ application: "mwein-hmis-platform", version: "1.1.0", commit: "a".repeat(40), shortCommit: "a".repeat(12), branch: "codex/release", deployment: "dpl_first", environment: "production" });
    expect(second.commit).toBe(first.commit);
    expect(second.deployment).not.toBe(first.deployment);
    expect(JSON.stringify(first)).not.toContain("must-not-be-exposed");
  });
});
