import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const backupDir = process.env.BACKUP_DIR || new URL("../data/backups", import.meta.url).pathname;

async function newestBackup() {
  const names = (await readdir(backupDir)).filter(name => name.endsWith(".sqlite")).sort().reverse();
  if (!names.length) throw new Error(`No SQLite backups found in ${backupDir}`);
  return join(backupDir, names[0]);
}

const sourcePath = process.env.BACKUP_PATH || await newestBackup();
const restoreDir = await mkdtemp(join(tmpdir(), "mwein-restore-check-"));
const restoredPath = join(restoreDir, "restored.sqlite");
const requiredTables = ["patients", "encounters", "prescriptions", "audit_events", "users", "sessions"];

try {
  await copyFile(sourcePath, restoredPath);
  const db = new DatabaseSync(restoredPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`Integrity check failed: ${integrity}`);

    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    const missing = requiredTables.filter(table => !tables.has(table));
    if (missing.length) throw new Error(`Required tables missing: ${missing.join(", ")}`);

    const auditRows = db.prepare("SELECT occurred_at, actor, action, record_id, outcome, request_id, previous_hash, event_hash FROM audit_events ORDER BY id").all();
    let previousHash = "GENESIS";
    for (const row of auditRows) {
      const expected = createHash("sha256")
        .update([previousHash, row.occurred_at, row.actor, row.action, row.record_id, row.outcome, row.request_id].join("\u001f"))
        .digest("hex");
      if (row.previous_hash !== previousHash || row.event_hash !== expected) throw new Error("Audit hash-chain verification failed");
      previousHash = row.event_hash;
    }

    db.exec("BEGIN IMMEDIATE; CREATE TABLE __restore_probe (id INTEGER PRIMARY KEY); DROP TABLE __restore_probe; ROLLBACK;");
    const counts = Object.fromEntries(requiredTables.map(table => [table, db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
    console.log(`Restore check passed for ${basename(sourcePath)}: ${JSON.stringify(counts)}`);
  } finally {
    db.close();
  }
} finally {
  await rm(restoreDir, { recursive: true, force: true });
}
