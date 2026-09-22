import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { identityHash } from "./restore-safety.mjs";
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(change = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "restore-guard-")); dirs.push(dir);
  const source = "postgresql://user:secret@source.example/main"; const target = "postgresql://user:secret@disposable.example/drill";
  const backup = path.join(dir, "backup.dump"); writeFileSync(backup, "synthetic backup");
  const calls = path.join(dir, "calls");
  for (const binary of ["psql", "pg_restore"]) {
    const file = path.join(dir, binary);
    writeFileSync(file, `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.TEST_CALLS, '${binary}\\n');if ('${binary}'==='psql') console.log(process.env.PGHOST.includes('source.example')?'123':process.env.TEST_TARGET_SYSTEM||'456');`); chmodSync(file, 0o700);
  }
  const approval = path.join(dir, "approval.json");
  writeFileSync(approval, JSON.stringify({ disposable: true, approvedBy: "synthetic operator", reference: "TEST", expiresAt: "2099-01-01", sourceIdentityHash: identityHash(source), targetIdentityHash: identityHash(target), sourceSystemIdentifier: "123", targetSystemIdentifier: "456", backupSha256: createHash("sha256").update("synthetic backup").digest("hex") }));
  const result = spawnSync(process.execPath, ["scripts/restore-drill.mjs"], { encoding: "utf8", env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, TEST_CALLS: calls, DATABASE_URL: source, RESTORE_DATABASE_URL: target, BACKUP_FILE: backup, RESTORE_APPROVAL_FILE: approval, ...change } });
  return { ...result, calls: existsSync(calls) ? readFileSync(calls, "utf8") : "" };
}
describe("restore process boundary with simulated PostgreSQL tools", () => {
  it("checks both systems before invoking the restore command", () => { const r = fixture(); expect(r.status).toBe(0); expect(r.calls).toBe("psql\npsql\npg_restore\n"); expect(r.stdout).not.toContain("secret"); });
  it("never invokes restore if live target identity is the source", () => { const r = fixture({ TEST_TARGET_SYSTEM: "123" }); expect(r.status).toBe(1); expect(r.calls).not.toContain("pg_restore"); });
  it("does not start a process for absent source or same target", () => { for (const change of [{ DATABASE_URL: "" }, { RESTORE_DATABASE_URL: "postgresql://other@source.example/main" }]) { const r = fixture(change); expect(r.status).toBe(1); expect(r.calls).toBe(""); expect(r.stderr).not.toContain("secret"); } });
});
