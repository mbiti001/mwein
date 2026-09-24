import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { databaseIdentity, validateRestorePlan, connectionEnvironment } from "./restore-safety.mjs";

const sourceUrl = process.env.DATABASE_URL?.trim();
const targetUrl = process.env.RESTORE_DATABASE_URL?.trim();
const backupFile = process.env.BACKUP_FILE?.trim();
const approvalFile = process.env.RESTORE_APPROVAL_FILE?.trim();

// Never print libpq diagnostics: they can contain connection strings or credentials.
function command(binary, args, connection) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: connectionEnvironment(connection), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 300_000);
    child.stdout.on("data", chunk => { if (output.length < 4096) output += chunk; });
    child.stderr.on("data", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new Error(`${binary} could not be started`)); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`${binary} failed; inspect protected operator diagnostics`)); });
  });
}
try {
  if (!backupFile || !approvalFile) throw new Error("BACKUP_FILE and RESTORE_APPROVAL_FILE are required");
  if (databaseIdentity(sourceUrl) === databaseIdentity(targetUrl)) throw new Error("Restore target matches source database");
  const approval = JSON.parse(await readFile(approvalFile, "utf8"));
  const file = path.resolve(backupFile);
  const before = await stat(file);
  if (!before.isFile()) throw new Error("Backup must be a regular file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const backupHash = hash.digest("hex");
  // Reject bad approval/checksum before contacting either database.
  validateRestorePlan({ sourceUrl, targetUrl, approval, backupHash, sourceSystem: approval.sourceSystemIdentifier, targetSystem: approval.targetSystemIdentifier });
  const sql = "SELECT system_identifier::text FROM pg_control_system()";
  const sourceSystem = await command("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], sourceUrl);
  const targetSystem = await command("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], targetUrl);
  validateRestorePlan({ sourceUrl, targetUrl, approval, backupHash, sourceSystem, targetSystem });
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("Backup changed during verification");
  await command("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--dbname", connectionEnvironment(targetUrl).PGDATABASE, file], targetUrl);
  console.log(JSON.stringify({ status: "restored", backupSha256: backupHash, target: "verified-disposable-database", approvalReference: approval.reference }));
} catch (error) {
  console.error(JSON.stringify({ status: "refused_or_failed", reason: error instanceof Error && !/(postgres|password|:\/\/)/i.test(error.message) ? error.message : "Restore failed; review protected configuration" }));
  process.exitCode = 1;
}
