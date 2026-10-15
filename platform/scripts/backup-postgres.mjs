import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { devNull } from "node:os";
import path from "node:path";
import { connectionEnvironment, identityHash } from "./restore-safety.mjs";

// Keep credentials and inherited libpq routing out of process arguments/logs.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PG|DATABASE_URL$|DIRECT_URL$|RESTORE_DATABASE_URL$)/i.test(key)));
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let staging;
let phase = "configuration";
let cleanupFailed = false;
class BackupFailure extends Error {}

function command(binary, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) return reject(new BackupFailure("interrupted"));
    const child = spawn(binary, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let failure;
    // Successful pg_dump warnings also need review; do not silently drop them.
    child.stderr.on("data", () => { failure ??= "tool_diagnostics_require_review"; });
    const stop = () => { failure = "interrupted"; child.kill("SIGKILL"); };
    const timer = setTimeout(() => { failure = "tool_timeout"; child.kill("SIGKILL"); }, timeoutMs);
    controller.signal.addEventListener("abort", stop, { once: true });
    child.once("error", () => { failure = "tool_start_failed"; });
    child.once("close", code => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", stop);
      code === 0 && !failure ? resolve() : reject(new BackupFailure(failure || "tool_failed"));
    });
  });
}

try {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const backupDirectory = process.env.BACKUP_DIR?.trim();
  if (!databaseUrl || !backupDirectory) throw new Error("configuration missing");
  const connection = connectionEnvironment(databaseUrl, inherited);
  if (!connection.PGUSER || Object.values(connection).some(value => value?.includes("\0")))
    throw new Error("explicit user and valid connection required");
  const timeoutSeconds = Number(process.env.BACKUP_TIMEOUT_SECONDS ?? "900");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400)
    throw new Error("invalid timeout");
  const resolvedDirectory = path.resolve(backupDirectory);
  if (resolvedDirectory === path.parse(resolvedDirectory).root) throw new Error("filesystem root refused");
  await mkdir(resolvedDirectory, { recursive: true, mode: 0o700 });
  const parent = await lstat(resolvedDirectory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("dedicated directory required");
  // Windows ACL protection must be provisioned on the dedicated parent by ops.
  if (process.platform !== "win32" && (parent.mode & 0o077)) throw new Error("private directory required");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  staging = await mkdtemp(path.join(resolvedDirectory, `.partial-mwein-${stamp}-`));
  await chmod(staging, 0o700);
  const output = path.join(staging, "backup.dump");
  const startedAt = new Date().toISOString();
  phase = "dump";
  await command("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--no-password", "--file", output], connection, timeoutSeconds * 1000);
  const archive = await lstat(output);
  if (!archive.isFile() || archive.isSymbolicLink() || archive.size === 0) throw new Error("missing archive");
  await chmod(output, 0o600);
  phase = "archive_list";
  await command("pg_restore", ["--list", output], inherited, timeoutSeconds * 1000);
  phase = "archive_decode";
  // No --dbname: decode every archive entry to the null device, never to a DB.
  await command("pg_restore", ["--exit-on-error", "--file", devNull, output], inherited, timeoutSeconds * 1000);
  phase = "checksum";
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(output)) {
    if (controller.signal.aborted) throw new Error("interrupted");
    digest.update(chunk);
  }
  const after = await lstat(output);
  if (after.size !== archive.size || after.mtimeMs !== archive.mtimeMs || after.ino !== archive.ino)
    throw new Error("archive changed");
  const sha256 = digest.digest("hex");
  await writeFile(path.join(staging, "backup.dump.sha256"), `${sha256}  backup.dump\n`, { flag: "wx", mode: 0o600 });
  const evidence = {
    status: "archive_verified_locally", startedAt, completedAt: new Date().toISOString(),
    sourceIdentitySha256: identityHash(databaseUrl), bytes: after.size, sha256,
    archiveListVerified: true, fullArchiveDecodeVerified: true,
    actualRestorePerformed: false, externalRetentionVerified: false,
  };
  await writeFile(path.join(staging, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (controller.signal.aborted) throw new Error("interrupted");
  phase = "publish";
  const completedDirectory = path.join(resolvedDirectory, path.basename(staging).replace(/^\.partial-/, ""));
  // Publish archive/checksum/evidence together with one same-volume rename.
  await rename(staging, completedDirectory);
  staging = undefined;
  console.log(JSON.stringify({ ...evidence, backup: path.join(completedDirectory, "backup.dump"), checksum: path.join(completedDirectory, "backup.dump.sha256"), evidence: path.join(completedDirectory, "evidence.json") }));
} catch (error) {
  if (staging) {
    // Only remove our known files then the empty directory, never a supplied tree.
    for (const name of ["backup.dump", "backup.dump.sha256", "evidence.json"]) {
      try { await unlink(path.join(staging, name)); } catch (error) { if (error.code !== "ENOENT") cleanupFailed = true; }
    }
    try { await rmdir(staging); } catch { cleanupFailed = true; }
  }
  console.error(JSON.stringify({ status: "refused_or_failed", phase, failure: error instanceof BackupFailure ? error.message : phase === "configuration" ? "invalid_configuration" : "artifact_io_or_validation_failed", interrupted: controller.signal.aborted, cleanupFailed,
    reason: "Backup not published. Check protected configuration, PostgreSQL tool availability and operator diagnostics; raw tool output is withheld." }));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
