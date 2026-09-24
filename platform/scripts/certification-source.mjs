import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Read only committed blobs. Working-tree content must never be attributed to a release SHA. */
export function collectCertificationSource({ repo, ref = "HEAD", allowDirty = false }) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const commit = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  const collectorCommit = git("rev-parse", "HEAD").trim();
  const dirty = git("status", "--porcelain", "--untracked-files=all").trim().length > 0;
  if (dirty && !allowDirty) throw new Error("Working tree is dirty. Commit the intended changes, or use --allow-dirty for a labelled non-release source snapshot.");
  const hashBlob = file => createHash("sha256").update(execFileSync("git", ["show", `${commit}:${file}`], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] })).digest("hex");
  const schemaPath = "platform/prisma/schema.prisma";
  const files = git("ls-tree", "-r", "--name-only", "-z", commit, "--", "platform/prisma/migrations").split("\0").filter(Boolean);
  const migrations = files.filter(file => /^platform\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(file)).sort().map(file => ({ name: file.split("/").at(-2), path: file, sha256: hashBlob(file) }));
  if (!migrations.length) throw new Error("Selected source has no committed migrations");
  return {
    commit, collectorCommit, workingTreeDirty: dirty,
    evidenceKind: dirty ? "NON_RELEASE_SOURCE_SNAPSHOT" : "COMMITTED_SOURCE_SNAPSHOT",
    schema: { path: schemaPath, sha256: hashBlob(schemaPath) },
    migrations, migrationCount: migrations.length, latestMigration: migrations.at(-1).name,
    runtimeEvidence: "NOT_COLLECTED",
  };
}
