import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { identityHash } from "./restore-safety.mjs";

const dirs = [];
const source = "postgresql://backup:synthetic%40secret@source.example/clinic?sslmode=require&channel_binding=require";
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(change = {}, mode = "success") {
  const dir = mkdtempSync(path.join(tmpdir(), "backup-guard-")); dirs.push(dir);
  chmodSync(dir, 0o700);
  const backupDirectory = path.join(dir, "backups");
  const calls = path.join(dir, "calls.jsonl");
  const tool = path.join(dir, "postgres-tool.cjs");
  writeFileSync(tool, `
    const fs = require('node:fs');
    const path = require('node:path');
    const [binary, ...args] = process.argv.slice(2);
    const mode = process.env.TEST_BACKUP_MODE;
    const phase = binary === 'pg_dump' ? 'dump' : args.includes('--list') ? 'list' : 'decode';
    const output = phase === 'dump' ? args[args.indexOf('--file') + 1] : args.at(-1);
    const secretCorrect = phase === 'dump' ? process.env.PGPASSWORD === 'synthetic@secret' : !process.env.PGPASSWORD;
    const forbidden = Object.keys(process.env).filter(k => /^(PGHOSTADDR|PGSERVICE|PGOPTIONS|DATABASE_URL|RESTORE_DATABASE_URL|DIRECT_URL)$/i.test(k));
    fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ binary, args, host: process.env.PGHOST, database: process.env.PGDATABASE, sslmode: process.env.PGSSLMODE, channelBinding: process.env.PGCHANNELBINDING, secretCorrect, forbidden, published: fs.readdirSync(path.dirname(path.dirname(output))).filter(n => n.startsWith('mwein-')) }) + '\\n');
    console.log('Synthetic confidential stdout: synthetic@secret');
    if (phase === 'dump' && mode !== 'missing') fs.writeFileSync(output, mode === 'empty' ? '' : 'synthetic archive');
    if (mode === 'interrupt' && process.send) process.send({ ready: true });
    if (mode === phase + '-fail') { console.error('postgresql://backup:synthetic@secret@source.example/clinic'); process.exitCode = 2; }
    if (mode === phase + '-warn') console.error('Synthetic secret warning synthetic@secret');
    if (mode === 'hang' || mode === 'interrupt') setTimeout(() => {}, 60000);
    if (mode === 'changed' && phase === 'decode') fs.appendFileSync(output, 'changed');
  `);
  const preload = path.join(dir, "preload.mjs");
  writeFileSync(preload, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = childProcess.spawn;
    childProcess.spawn = (binary, args, options) => {
      if (!['pg_dump', 'pg_restore'].includes(binary)) throw new Error('Unexpected test command');
      if (process.env.TEST_BACKUP_MODE === 'unavailable') return spawn('missing-mwein-pg-dump-test', args, options);
      const interrupt = process.env.TEST_BACKUP_MODE === 'interrupt';
      const child = spawn(process.execPath, [${JSON.stringify(tool)}, binary, ...args], interrupt ? { ...options, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] } : options);
      // Interrupt the running fake tool after its trace is complete. A fixed
      // startup timer can kill appendFileSync mid-record under host contention.
      if (interrupt) child.once('message', message => { if (message?.ready === true) process.emit('SIGTERM'); });
      return child;
    };
    syncBuiltinESMExports();
  `);
  const args = ["--import", pathToFileURL(preload).href, "scripts/backup-postgres.mjs"];
  const options = {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, TEST_CALLS: calls, TEST_BACKUP_MODE: mode, DATABASE_URL: source, BACKUP_DIR: backupDirectory,
      RESTORE_DATABASE_URL: "not-for-backup", DIRECT_URL: "not-for-backup", PGHOSTADDR: "other-system", PGSERVICE: "other-system", pgoptions: "unsafe", BACKUP_TIMEOUT_SECONDS: "2", ...change },
  };
  const result = spawnSync(process.execPath, args, options);
  const runAgain = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", status => resolve({ status, stdout, stderr }));
  });
  return { ...result, dir, backupDirectory, runAgain, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : [] };
}

describe("backup process boundary using simulated PostgreSQL tools", () => {
  it("keeps credentials out of arguments/logs, preserves TLS and publishes only a verified complete set", () => {
    const r = fixture();
    expect(r.status, r.stderr).toBe(0);
    const evidence = JSON.parse(r.stdout);
    expect(evidence).toMatchObject({ status: "archive_verified_locally", sourceIdentitySha256: identityHash(source), actualRestorePerformed: false, externalRetentionVerified: false });
    expect(r.calls.map(c => c.binary)).toEqual(["pg_dump", "pg_restore", "pg_restore"]);
    expect(r.calls[0]).toMatchObject({ host: "source.example", database: "clinic", sslmode: "require", channelBinding: "require", secretCorrect: true });
    expect(r.calls[0].args).toContain("--no-password");
    expect(r.calls[2].args).toEqual(["--exit-on-error", "--file", devNull, r.calls[1].args.at(-1)]);
    for (const call of r.calls) {
      expect(call).toMatchObject({ secretCorrect: true, forbidden: [], published: [] });
      expect(call.args).not.toContain("--dbname");
    }
    expect(r.calls[1].host).toBeUndefined();
    expect(JSON.stringify(r.calls) + r.stdout + r.stderr).not.toMatch(/synthetic(@|%40)secret/);
    const sha256 = createHash("sha256").update(readFileSync(evidence.backup)).digest("hex");
    expect(evidence.sha256).toBe(sha256);
    expect(readFileSync(evidence.checksum, "utf8")).toBe(`${sha256}  backup.dump\n`);
    expect(JSON.parse(readFileSync(evidence.evidence, "utf8"))).toMatchObject({ sha256, bytes: 17 });
    expect(readdirSync(r.backupDirectory)).toEqual([path.basename(path.dirname(evidence.backup))]);
    if (process.platform !== "win32") {
      expect(statSync(path.dirname(evidence.backup)).mode & 0o777).toBe(0o700);
      for (const file of [evidence.backup, evidence.checksum, evidence.evidence]) expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps prior backups intact during simultaneous runs into the same directory", async () => {
    const first = fixture();
    expect(first.status).toBe(0);
    const previous = JSON.parse(first.stdout);
    const previousBytes = readFileSync(previous.backup);
    const results = await Promise.all([first.runAgain(), first.runAgain()]);
    for (const result of results) expect(result.status, result.stderr).toBe(0);
    const paths = [previous.backup, ...results.map(result => JSON.parse(result.stdout).backup)];
    expect(new Set(paths).size).toBe(3);
    expect(readdirSync(first.backupDirectory).length).toBe(3);
    expect(readFileSync(previous.backup)).toEqual(previousBytes);
  });

  it.each(["dump-fail", "list-fail", "decode-fail", "dump-warn", "list-warn", "decode-warn", "empty", "missing", "changed", "unavailable", "hang", "interrupt"])("refuses %s without publishing or leaking diagnostics", mode => {
    const r = fixture({}, mode);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr)).toMatchObject({ status: "refused_or_failed", cleanupFailed: false });
    if (mode === "interrupt") {
      expect(JSON.parse(r.stderr).interrupted).toBe(true);
      expect(r.calls.map(call => call.binary)).toEqual(["pg_dump"]);
    }
    if (mode === "hang") expect(JSON.parse(r.stderr).failure).toBe("tool_timeout");
    if (mode === "unavailable") expect(JSON.parse(r.stderr).failure).toBe("tool_start_failed");
    if (mode.endsWith("-warn")) expect(JSON.parse(r.stderr).failure).toBe("tool_diagnostics_require_review");
    expect(r.stderr).not.toMatch(/synthetic|postgresql:\/\//);
    expect(readdirSync(r.backupDirectory)).toEqual([]);
  });

  it.each([
    { DATABASE_URL: "" }, { DATABASE_URL: "not-a-uri" }, { DATABASE_URL: "postgresql://backup:secret@host/clinic?host=other" },
    { DATABASE_URL: "postgresql://host/clinic" }, { DATABASE_URL: "postgresql://backup:%00@host/clinic" },
    { DATABASE_URL: "postgresql://backup@host/host%3Dother%20dbname%3Dclinic" },
    { DATABASE_URL: "postgresql://backup@host/postgresql%3A%2F%2Fother%2Fclinic" },
    { BACKUP_DIR: "" }, { BACKUP_DIR: path.parse(process.cwd()).root }, { BACKUP_TIMEOUT_SECONDS: "0" }, { BACKUP_TIMEOUT_SECONDS: "no" },
  ])("refuses unsafe configuration before starting PostgreSQL: %j", change => {
    const r = fixture(change);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(JSON.parse(r.stderr).phase).toBe("configuration");
  });
});
