import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function inspectRoute(source, delegates = {}) {
  const starts = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\s*\(/g)];
  return starts.map((match, index) => {
    const body = source.slice(match.index, starts[index + 1]?.index ?? source.length);
    const auditPattern = /await\s+(?:recordClinicalAccess|recordDisclosure)\s*\(|appendAudit\s*\(/;
    const direct = auditPattern.test(body);
    const delegated = Object.entries(delegates).some(([name, implementation]) => new RegExp(`\\b${name}\\s*\\(`).test(body) && auditPattern.test(implementation));
    return { method: match[1], auditCallDetected: direct || delegated };
  });
}
export function reviewMatches(source, review) {
  return Boolean(review?.sourceSha256 && createHash("sha256").update(source).digest("hex") === review.sourceSha256);
}
export function auditInventory(platformRoot) {
  const root = path.join(platformRoot, "src/app/api");
  const reviews = JSON.parse(readFileSync(path.join(platformRoot, "certification/audit-route-review.json"), "utf8")).routes;
  function files(directory) { return readdirSync(directory).flatMap(name => { const target = path.join(directory, name); return statSync(target).isDirectory() ? files(target) : target.endsWith("route.ts") ? [target] : []; }); }
  const report = files(root).map(file => {
    const route = path.relative(root, file).split(path.sep).join("/").replace(/\/route\.ts$/, "");
    const source = readFileSync(file, "utf8");
    const review = reviews[route];
    const reviewed = reviewMatches(source, review);
    const delegates = { auditedOperationalJson: readFileSync(path.join(platformRoot, "src/lib/audited-json.ts"), "utf8"), ...(route === "visits/[id]/discharge" ? { closeClinicalVisit: readFileSync(path.join(platformRoot, "src/lib/close-visit.ts"), "utf8") } : {}) };
    const controls = inspectRoute(source, delegates).map(control => ({ ...control, ...(reviewed && review.methodExceptions?.[control.method] ? { exception: review.methodExceptions[control.method] } : {}) }));
    const aliases = [...source.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=/g)].map(match => match[1]);
    for (const method of aliases) controls.push({ method, auditCallDetected: false, ...(reviewed && review.methodExceptions?.[method] ? { exception: review.methodExceptions[method] } : {}) });
    return { route, scope: reviewed ? "reviewed" : "requires-classification", controls, aliasedMethodsRequireReview: aliases.some(method => !reviewed || !review.methodExceptions?.[method]) };
  });
  const gaps = report.filter(item => item.controls.some(control => !control.auditCallDetected && !control.exception));
  return { generatedAt: new Date().toISOString(), routes: report.length, gaps: gaps.length, unclassified: report.filter(item => item.scope === "requires-classification").length, aliases: report.filter(item => item.aliasedMethodsRequireReview).length, limitation: "This is a source-bound engineering inventory, not proof of complete branch coverage, independent security assessment or external audit retention. Exceptions require exact source hashes. Behavioral tests remain necessary.", coverage: report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = auditInventory(path.resolve(import.meta.dirname, ".."));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.ENFORCE_AUDIT_COVERAGE === "true" && (result.gaps || result.unclassified || result.aliases)) process.exitCode = 1;
}
