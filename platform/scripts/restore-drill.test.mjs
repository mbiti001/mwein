import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
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
  const tool = path.join(dir, "postgres-tool.cjs");
  writeFileSync(tool, `
    const fs = require('node:fs');
    const [binary, ...args] = process.argv.slice(2);
    fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ binary, args, host: process.env.PGHOST, database: process.env.PGDATABASE }) + '\\n');
    if (binary === 'psql') console.log(process.env.PGHOST === 'source.example' ? '123' : process.env.TEST_TARGET_SYSTEM || '456');
  `);
  // Keep real subprocesses and the unmodified restore entry point, but launch the
  // synthetic tools through Node. PATH shebang executables do not run on Windows.
  // This preload exists only in the test subprocess; production gets no test hook.
  const preload = path.join(dir, "preload.mjs");
  writeFileSync(preload, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (binary, args, options) => {
      if (!['psql', 'pg_restore'].includes(binary)) throw new Error('Unexpected test command');
      return spawn(process.execPath, [${JSON.stringify(tool)}, binary, ...args], options);
    };
    syncBuiltinESMExports();
  `);
  const approval = path.join(dir, "approval.json");
  writeFileSync(approval, JSON.stringify({ disposable: true, approvedBy: "synthetic operator", reference: "TEST", expiresAt: "2099-01-01", sourceIdentityHash: identityHash(source), targetIdentityHash: identityHash(target), sourceSystemIdentifier: "123", targetSystemIdentifier: "456", backupSha256: createHash("sha256").update("synthetic backup").digest("hex") }));
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, "scripts/restore-drill.mjs"], { encoding: "utf8", env: { ...process.env, TEST_CALLS: calls, DATABASE_URL: source, RESTORE_DATABASE_URL: target, BACKUP_FILE: backup, RESTORE_APPROVAL_FILE: approval, ...change } });
  return { ...result, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
}
describe("restore process boundary with simulated PostgreSQL tools", () => {
  it("checks both systems before invoking the restore command", () => {
    const r = fixture();
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.map(call => [call.binary, call.host, call.database])).toEqual([
      ["psql", "source.example", "main"], ["psql", "disposable.example", "drill"], ["pg_restore", "disposable.example", "drill"],
    ]);
    expect(r.calls[2].args).toEqual(expect.arrayContaining(["--single-transaction", "--exit-on-error", "--dbname", "drill"]));
    expect(JSON.stringify(r.calls)).not.toContain("secret");
    expect(r.stdout).not.toContain("secret");
  });
  it("never invokes restore if live target identity is the source", () => {
    const r = fixture({ TEST_TARGET_SYSTEM: "123" });
    expect(r.status).toBe(1);
    expect(r.calls.map(call => call.binary)).toEqual(["psql", "psql"]);
    expect(r.stderr).toContain("distinct approved database systems");
  });
  it("does not start a process for absent source, same target or database-string redirection", () => { for (const change of [{ DATABASE_URL: "" }, { RESTORE_DATABASE_URL: "postgresql://other@source.example/main" }, { RESTORE_DATABASE_URL: "postgresql://other@disposable.example/host%3Dsource.example%20dbname%3Dmain" }]) { const r = fixture(change); expect(r.status).toBe(1); expect(r.calls).toEqual([]); expect(r.stderr).not.toContain("secret"); } });
});
