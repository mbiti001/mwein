import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(change = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "backup-process-")); dirs.push(dir);
  const destination = path.join(dir, "backups"); mkdirSync(destination, { mode: 0o755 });
  const calls = path.join(dir, "calls.json");
  const binary = path.join(dir, "pg_dump");
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(process.env.TEST_CALLS,JSON.stringify({args,host:process.env.PGHOST,user:process.env.PGUSER,password:process.env.PGPASSWORD,override:process.env.PGHOSTADDR}));fs.writeFileSync(args[args.indexOf('--file')+1],'synthetic backup');if(process.env.TEST_FAIL){console.error('password=synthetic-secret');process.exit(1);}`);
  chmodSync(binary, 0o700);
  const result = spawnSync(process.execPath, ["scripts/backup-postgres.mjs"], { encoding: "utf8", env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, DATABASE_URL: "postgresql://operator:synthetic-secret@db.example/app?sslmode=require", BACKUP_DIR: destination, TEST_CALLS: calls, PGHOSTADDR: "wrong.example", ...change } });
  return { ...result, destination, calls: existsSync(calls) ? JSON.parse(readFileSync(calls, "utf8")) : null };
}
describe("backup process boundary with simulated PostgreSQL tooling", () => {
  it("keeps credentials out of arguments, removes redirect overrides and writes private verified files", () => {
    const r = fixture(); expect(r.status).toBe(0);
    expect(JSON.stringify(r.calls.args)).not.toContain("synthetic-secret");
    expect(r.calls.args.join(" ")).not.toContain("postgresql:");
    expect(r.calls).toMatchObject({host:"db.example",user:"operator",password:"synthetic-secret"});
    expect(r.calls.override).toBeUndefined();
    const result = JSON.parse(r.stdout); expect(statSync(result.backup).mode & 0o777).toBe(0o600);
    expect(statSync(result.checksum).mode & 0o777).toBe(0o600);
    expect(readFileSync(result.checksum,"utf8")).toBe(`${createHash("sha256").update("synthetic backup").digest("hex")}  ${path.basename(result.backup)}\n`);
    expect(readdirSync(r.destination).some(f => f.endsWith(".partial"))).toBe(false);
  });
  it("withholds failing-tool diagnostics and removes incomplete backups", () => {
    const r = fixture({TEST_FAIL:"true"}); expect(r.status).toBe(1);
    expect(r.stdout+r.stderr).not.toContain("synthetic-secret");
    expect(readdirSync(r.destination)).toEqual([]);
  });
  it("rejects absent connections and unsupported redirect options before subprocesses", () => {
    for(const url of ["", "postgresql://operator:synthetic-secret@db.example/app?host=other.example"]){
      const r=fixture({DATABASE_URL:url}); expect(r.status).toBe(1); expect(r.calls).toBeNull();
      expect(readdirSync(r.destination)).toEqual([]); expect(r.stderr).not.toContain("synthetic-secret");
    }
  });
});
