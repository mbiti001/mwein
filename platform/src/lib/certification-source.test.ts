import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
// @ts-expect-error Operational scripts are exercised as their native ESM modules.
import { collectCertificationSource } from "../../scripts/certification-source.mjs";
let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
function write(file: string, value: string) { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), value); }
beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "mwein-source-evidence-"));
  git("init", "-q"); git("config", "user.name", "Synthetic test"); git("config", "user.email", "test@example.test");
  write("platform/prisma/schema.prisma", "committed schema\n");
  write("platform/prisma/migrations/20260101000000_initial/migration.sql", "SELECT 1;\n");
  git("add", "."); git("commit", "-qm", "Initial synthetic source");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));
it("hashes committed blobs and labels a source snapshot separately from runtime evidence", () => {
  const evidence = collectCertificationSource({ repo });
  expect(evidence.commit).toBe(git("rev-parse", "HEAD"));
  expect(evidence.schema.sha256).toBe(createHash("sha256").update("committed schema\n").digest("hex"));
  expect(evidence.migrationCount).toBe(1);
  expect(evidence.migrations[0].sha256).toBe(createHash("sha256").update("SELECT 1;\n").digest("hex"));
  expect(evidence.workingTreeDirty).toBe(false);
  expect(evidence.runtimeEvidence).toBe("NOT_COLLECTED");
});
it.each(["schema", "migration", "untracked migration"])("rejects misleading release evidence for a dirty %s", kind => {
  const file = kind === "schema" ? "platform/prisma/schema.prisma" : `platform/prisma/migrations/${kind === "migration" ? "20260101000000_initial" : "20260201000000_paused_mfa"}/migration.sql`;
  write(file, "uncommitted data");
  expect(() => collectCertificationSource({ repo })).toThrow("Working tree is dirty");
  const snapshot = collectCertificationSource({ repo, allowDirty: true });
  expect(snapshot.evidenceKind).toBe("NON_RELEASE_SOURCE_SNAPSHOT");
  expect(snapshot.migrationCount).toBe(1);
  expect(snapshot.schema.sha256).toBe(createHash("sha256").update("committed schema\n").digest("hex"));
});
it("inventories the selected old release without newer committed migrations", () => {
  const release = git("rev-parse", "HEAD");
  write("platform/prisma/migrations/20260201000000_later/migration.sql", "SELECT 2;\n");
  git("add", "."); git("commit", "-qm", "Later changes");
  const evidence = collectCertificationSource({ repo, ref: release });
  expect(evidence.commit).toBe(release);
  expect(evidence.collectorCommit).toBe(git("rev-parse", "HEAD"));
  expect(evidence.migrationCount).toBe(1);
});
