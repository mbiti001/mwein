import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim());
const migrations = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort();
const migrationDigest = createHash("sha256").update(migrations.map((name) => `${name}:${createHash("sha256").update(readFileSync(path.join(root, "prisma/migrations", name, "migration.sql"))).digest("hex")}`).join("\n")).digest("hex");
const manifest = { application: "mwein-hmis-platform", generatedAt: new Date().toISOString(), commit, cleanWorkingTree: !dirty, migrationCount: migrations.length, latestMigration: migrations.at(-1), migrationDigest, requiredEvidence: ["production database backup reference", "migration reconciliation", "release approver", "rollback owner and procedure", "post-deploy health and smoke results"] };
console.log(JSON.stringify(manifest, null, 2));
if (dirty && process.env.ALLOW_DIRTY_RELEASE !== "true") { console.error("Release preflight blocked: working tree is not clean"); process.exitCode = 1; }
