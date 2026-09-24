import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, open, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { connectionEnvironment } from "./restore-safety.mjs";

let partial;
let output;
let complete = false;
try {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const backupDirectory = process.env.BACKUP_DIR?.trim();
  // Validate the connection before creating files or launching a subprocess.
  const environment = connectionEnvironment(databaseUrl);
  if (!backupDirectory) throw new Error("BACKUP_DIR must identify the dedicated backup directory");
  const directory = path.resolve(backupDirectory);
  if (directory === path.parse(directory).root) throw new Error("BACKUP_DIR cannot be a filesystem root");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  output = path.join(directory, `mwein-${stamp}-${randomUUID()}.dump`);
  partial = `${output}.partial`;
  // Reserve a private, unique file before pg_dump writes it, even in an existing directory.
  const handle = await open(partial, "wx", 0o600);
  await handle.close();
  await new Promise((resolve, reject) => {
    // Connection credentials stay out of argv and subprocess diagnostics are not forwarded.
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", partial], {
      env: environment, stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Backup tool could not be started")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Backup tool failed; no completed backup retained")); });
  });
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(partial)) digest.update(chunk);
  await rename(partial, output);
  await writeFile(`${output}.sha256`, `${digest.digest("hex")}  ${path.basename(output)}\n`, { mode: 0o600, flag: "wx" });
  complete = true;
  console.log(JSON.stringify({ status: "created", backup: output, checksum: `${output}.sha256` }));
} catch {
  // OS errors can contain paths or connection details. Emit a fixed diagnostic only.
  console.error(JSON.stringify({ status: "failed", reason: "Backup failed; verify protected configuration, destination and PostgreSQL tooling" }));
  process.exitCode = 1;
} finally {
  if (!complete) {
    for (const file of [partial, output, output && `${output}.sha256`].filter(Boolean)) {
      await rm(file, { force: true }).catch(() => {
        console.error(JSON.stringify({ status: "cleanup_required", reason: "Inspect the protected backup directory for incomplete files" }));
      });
    }
  }
}
