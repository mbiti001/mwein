import { chmod, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

const dataDir = process.env.DATA_DIR || new URL("../data", import.meta.url).pathname;
const sourcePath = process.env.DATABASE_PATH || join(dataDir, "mwein-emr.sqlite");
const backupDir = process.env.BACKUP_DIR || join(dataDir, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(backupDir, `mwein-emr-${stamp}.sqlite`);

await mkdir(backupDir, { recursive: true });
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(source, destination);
} finally {
  source.close();
}

const verification = new DatabaseSync(destination, { readOnly: true });
try {
  const result = verification.prepare("PRAGMA integrity_check").get();
  if (result.integrity_check !== "ok") throw new Error(`Backup verification failed: ${result.integrity_check}`);
  const tables = verification.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get().count;
  if (tables < 1) throw new Error("Backup verification failed: no database tables found");
} finally {
  verification.close();
}

await chmod(destination, 0o600);
await Promise.all([
  rm(`${destination}-wal`, { force: true }),
  rm(`${destination}-shm`, { force: true })
]);
console.log(`Verified backup created: ${basename(destination)}`);
