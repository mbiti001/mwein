import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptPath = fileURLToPath(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function collectEvidence({ repo, commit: requestedCommit }) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  const resolve = (ref) => {
    if (typeof ref !== "string" || !ref.trim() || ref.startsWith("-")) throw new Error("Select a valid Git commit or ref.");
    try { return git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).toString().trim(); }
    catch { throw new Error("The selected Git commit could not be resolved."); }
  };
  const documentCommit = resolve("HEAD");
  const dirty = git("status", "--porcelain=v1", "--untracked-files=all").length > 0;
  if (dirty && requestedCommit === undefined) throw new Error("Working tree has unpublished changes. Select --commit explicitly to collect committed source only.");
  const commit = resolve(requestedCommit ?? "HEAD");
  const tree = git("ls-tree", "-r", "-z", commit, "--", "platform/").toString().split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    const [mode, type, oid] = entry.slice(0, separator).split(" ");
    return { mode, type, oid, path: entry.slice(separator + 1) };
  });
  const artifact = (name) => {
    const entry = tree.find((item) => item.path === name);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error(`Required committed regular file is missing: ${name}`);
    const bytes = git("cat-file", "blob", entry.oid);
    return { path: name, gitBlob: entry.oid, sha256: sha256(bytes), bytes: bytes.length };
  };
  const migrations = tree.filter((entry) => /^platform\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(entry.path))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map((entry) => ({ name: entry.path.split("/").at(-2), ...artifact(entry.path) }));
  if (!migrations.length) throw new Error("The selected commit contains no migration SQL files.");
  return {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    application: "mwein-hmis-platform",
    evidenceType: "COMMITTED_SOURCE_MANIFEST",
    commit,
    latestMigration: migrations.at(-1).name,
    migrationCount: migrations.length,
    source: { selection: requestedCommit === undefined ? "CLEAN_HEAD" : "EXPLICIT_COMMIT", workingTreeUsed: false },
    collection: { documentCommit, workingTreeDirty: dirty, generatorSha256: sha256(readFileSync(scriptPath)), note: "Document checkout HEAD and generator hash describe collection tooling, not the selected application release." },
    artifacts: ["platform/prisma/schema.prisma", "platform/prisma/migrations/migration_lock.toml", "platform/package.json", "platform/package-lock.json"].map(artifact),
    migrations,
    runtimeVerification: { status: "NOT_PERFORMED", note: "Run ops:release-verify with this commit and latestMigration and retain the dated result separately." },
    controlAssessment: "NOT_PERFORMED",
    declaration: "Committed source inventory only. This does not prove deployment, operational controls, DHA certification, legal approval or clinical acceptance.",
  };
}
export function parseArguments(args) {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--commit" && args[1] && !args[1].startsWith("-")) return { commit: args[1] };
  throw new Error("Usage: node scripts/certification-evidence.mjs [--commit <commit-or-ref>]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    console.log(JSON.stringify(collectEvidence({ repo: path.resolve(path.dirname(scriptPath), "../.."), ...parseArguments(process.argv.slice(2)) }), null, 2));
  } catch (error) {
    // Git stderr can contain local configuration; keep it out of evidence output.
    console.error(error?.stderr !== undefined ? "Unable to read committed source from Git." : error.message);
    process.exitCode = 1;
  }
}
