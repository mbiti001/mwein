import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL?.trim();
const backupDirectory = process.env.BACKUP_DIR?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!backupDirectory) throw new Error("BACKUP_DIR must identify the dedicated backup directory");
const resolvedDirectory = path.resolve(backupDirectory);
if (resolvedDirectory === path.parse(resolvedDirectory).root)
  throw new Error("BACKUP_DIR cannot be a filesystem root");

await mkdir(resolvedDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(":", "-").replace(".000Z", "Z");
const output = path.join(resolvedDirectory, `mwein-${stamp}.dump`);

await new Promise((resolve, reject) => {
  const process = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", output, databaseUrl], { stdio: "inherit" });
  process.once("error", reject);
  process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}`)));
});

const digest = createHash("sha256");
await new Promise((resolve, reject) => {
  const stream = createReadStream(output);
  stream.on("data", (chunk) => digest.update(chunk));
  stream.once("end", resolve);
  stream.once("error", reject);
});
const checksum = `${digest.digest("hex")}  ${path.basename(output)}\n`;
await writeFile(`${output}.sha256`, checksum, { mode: 0o600 });
console.log(JSON.stringify({ status: "created", backup: output, checksum: `${output}.sha256` }));
