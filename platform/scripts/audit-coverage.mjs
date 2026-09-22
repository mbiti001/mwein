import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src/app/api");
const sensitive = ["patients", "visits", "orders", "referrals", "reports", "appointments"];
function files(directory) { return readdirSync(directory).flatMap((name) => { const target = path.join(directory, name); return statSync(target).isDirectory() ? files(target) : target.endsWith("route.ts") ? [target] : []; }); }
const routes = files(root).filter((file) => sensitive.some((segment) => file.includes(`${path.sep}${segment}${path.sep}`)));
const report = routes.map((file) => { const source = readFileSync(file, "utf8"); const methods = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((match) => match[1]); const readsClinicalData = methods.includes("GET"); return { route: path.relative(root, file).split(path.sep).join("/").replace(/\/route\.ts$/, ""), methods, readAudit: !readsClinicalData || source.includes("recordClinicalAccess"), mutationAudit: !methods.some((method) => method !== "GET") || source.includes("appendAudit") }; });
const gaps = report.filter((item) => !item.readAudit || !item.mutationAudit);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), routes: report.length, gaps: gaps.length, coverage: report }, null, 2));
if (process.env.ENFORCE_AUDIT_COVERAGE === "true" && gaps.length) process.exitCode = 1;
