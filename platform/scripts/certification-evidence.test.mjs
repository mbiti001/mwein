import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectEvidence, parseArguments } from "./certification-evidence.mjs";
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mwein-evidence-")); roots.push(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (name, content) => { const file = path.join(repo, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); };
  git("init"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Evidence Test");
  for (const [name, content] of Object.entries({
    "platform/prisma/schema.prisma": "// committed schema\n",
    "platform/prisma/migrations/migration_lock.toml": 'provider = "postgresql"\n',
    "platform/package.json": '{}\n', "platform/package-lock.json": '{}\n',
    "platform/prisma/migrations/001_base/migration.sql": "SELECT 1;\n",
    "platform/prisma/migrations/002_next/migration.sql": "SELECT 2;\n",
  })) write(name, content);
  git("add", "."); git("commit", "-m", "Release fixture");
  return { repo, git, write, commit: git("rev-parse", "HEAD") };
}
describe("committed release evidence", () => {
  it("hashes exact committed bytes and inventories committed SQL", () => {
    const { repo, git, commit } = fixture(); const result = collectEvidence({ repo });
    expect(result.commit).toBe(commit); expect(result.migrationCount).toBe(2); expect(result.latestMigration).toBe("002_next");
    expect(result.source.selection).toBe("CLEAN_HEAD"); expect(result.runtimeVerification.status).toBe("NOT_PERFORMED");
    for (const file of [...result.artifacts, ...result.migrations]) {
      const bytes = execFileSync("git", ["show", `${commit}:${file.path}`], { cwd: repo });
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(file.bytes).toBe(bytes.length); expect(file.gitBlob).toBe(git("rev-parse", `${commit}:${file.path}`));
    }
  });
  it.each(["modified", "staged", "untracked"])("rejects implicit dirty evidence (%s), excludes drafts with explicit commit", (kind) => {
    const { repo, git, write, commit } = fixture();
    if (kind === "untracked") write("platform/prisma/migrations/999_paused_mfa/migration.sql", "PRIVATE_DRAFT");
    else {
      write("platform/prisma/schema.prisma", "PRIVATE_DRAFT"); write("platform/prisma/migrations/002_next/migration.sql", "PRIVATE_DRAFT");
      if (kind === "staged") git("add", ".");
    }
    expect(() => collectEvidence({ repo })).toThrow("unpublished changes");
    const result = collectEvidence({ repo, commit });
    expect(result.collection.workingTreeDirty).toBe(true); expect(result.source.workingTreeUsed).toBe(false); expect(result.migrationCount).toBe(2);
    expect(result.artifacts[0].sha256).toBe(createHash("sha256").update("// committed schema\n").digest("hex"));
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DRAFT"); expect(JSON.stringify(result)).not.toContain("paused_mfa");
  });
  it("distinguishes a historical release from the document checkout", () => {
    const { repo, git, write, commit } = fixture();
    write("platform/prisma/migrations/003_future/migration.sql", "SELECT 3;"); git("add", "."); git("commit", "-m", "Later release");
    const result = collectEvidence({ repo, commit });
    expect(result.commit).toBe(commit); expect(result.collection.documentCommit).toBe(git("rev-parse", "HEAD"));
    expect(result.collection.documentCommit).not.toBe(commit); expect(result.migrationCount).toBe(2);
  });
  it("fails closed for absent committed artifacts and invalid refs", () => {
    const { repo, git } = fixture();
    expect(() => collectEvidence({ repo, commit: "missing-ref" })).toThrow("could not be resolved");
    expect(() => collectEvidence({ repo, commit: "--help" })).toThrow("valid Git commit");
    git("rm", "platform/prisma/schema.prisma"); git("commit", "-m", "Missing schema");
    expect(() => collectEvidence({ repo })).toThrow("Required committed regular file");
  });
  it("accepts only documented CLI arguments", () => {
    expect(parseArguments([])).toEqual({}); expect(parseArguments(["--commit", "HEAD"])).toEqual({ commit: "HEAD" });
    for (const args of [["--commit"], ["--commit", "--help"], ["--unknown"], ["--commit", "HEAD", "extra"]]) expect(() => parseArguments(args)).toThrow("Usage:");
  });
});
