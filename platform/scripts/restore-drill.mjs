import { spawn } from "node:child_process";
import path from "node:path";

const sourceDatabaseUrl = process.env.DATABASE_URL?.trim();
const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL?.trim();
const backupFile = process.env.BACKUP_FILE?.trim();
if (!restoreDatabaseUrl) throw new Error("RESTORE_DATABASE_URL must identify a disposable restore-drill database");
if (!backupFile) throw new Error("BACKUP_FILE is required");
if (sourceDatabaseUrl && restoreDatabaseUrl === sourceDatabaseUrl)
  throw new Error("RESTORE_DATABASE_URL must not be the production DATABASE_URL");
const resolvedBackup = path.resolve(backupFile);

await new Promise((resolve, reject) => {
  const process = spawn("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", restoreDatabaseUrl, resolvedBackup], { stdio: "inherit" });
  process.once("error", reject);
  process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_restore exited with ${code}`)));
});
console.log(JSON.stringify({ status: "restored", backup: resolvedBackup, target: "disposable-database" }));
