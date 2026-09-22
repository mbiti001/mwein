import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function inspectRoute(source, delegates = {}) {
  const starts = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\s*\(/g)];
  return starts.map((match, index) => {
    const body = source.slice(match.index, starts[index + 1]?.index ?? source.length);
    const direct = /await\s+(?:recordClinicalAccess|recordDisclosure)\s*\(|appendAudit\s*\(/.test(body);
    const delegated = Object.entries(delegates).some(([name, implementation]) => new RegExp(`\\b${name}\\s*\\(`).test(body) && /appendAudit\s*\(/.test(implementation));
    return { method: match[1], auditCallDetected: direct || delegated };
  });
}
export function auditInventory(platformRoot) {
  const root = path.join(platformRoot, "src/app/api");
  const families = ["surveillance", "patients", "visits", "orders", "referrals", "reports", "appointments", "visit-summaries"];
  function files(directory) { return readdirSync(directory).flatMap(name => { const target = path.join(directory, name); return statSync(target).isDirectory() ? files(target) : target.endsWith("route.ts") ? [target] : []; }); }
  const report = files(root).map(file => {
    const route = path.relative(root, file).split(path.sep).join("/").replace(/\/route\.ts$/, "");
    const source = readFileSync(file, "utf8");
    const reviewed = families.includes(route.split("/")[0]) || route === "admin/patient-rights";
    const delegates = route === "visits/[id]/discharge" ? { closeClinicalVisit: readFileSync(path.join(platformRoot, "src/lib/close-visit.ts"), "utf8") } : {};
    // Reviewed retirement response: authenticated 410, no patient query or payload.
    // Pin the full file so any implementation change requires classification again.
    const retired = route === "admin/patient-rights" && createHash("sha256").update(source).digest("hex") === "c68332e316c1826df49c62f39d268c2e09b3230bf8ac50a27a19e73e75a42cee";
    const controls = inspectRoute(source, delegates);
    return { route, scope: retired ? "reviewed-retired-no-disclosure" : reviewed ? "sensitive-reviewed-family" : "requires-classification", controls, aliasedMethodsRequireReview: /export const (GET|POST|PATCH|PUT|DELETE)/.test(source) };
  });
  const gaps = report.filter(item => item.scope === "sensitive-reviewed-family" && item.controls.some(control => !control.auditCallDetected));
  return { generatedAt: new Date().toISOString(), routes: report.length, gaps: gaps.length, unclassified: report.filter(item => item.scope === "requires-classification").length, limitation: "Static call detection is not proof of fail-closed behavior. Behavioral tests and review remain required; unclassified routes and aliases must not be treated as covered.", coverage: report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = auditInventory(path.resolve(import.meta.dirname, ".."));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.ENFORCE_AUDIT_COVERAGE === "true" && result.gaps) process.exitCode = 1;
}
