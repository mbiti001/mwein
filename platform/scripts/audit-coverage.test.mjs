import { describe, it, expect } from "vitest";
import { inspectRoute } from "./audit-coverage.mjs";
describe("audit call inventory", () => {
  it("does not mistake an import or a mutation audit for a read audit", () => {
    const source = 'import { appendAudit } from "audit"; export async function GET() { return data; } export async function POST() { await appendAudit(tx, event); }';
    expect(inspectRoute(source)).toEqual([{ method: "GET", auditCallDetected: false }, { method: "POST", auditCallDetected: true }]);
  });
  it("recognizes direct read events and verified discharge delegate", () => {
    expect(inspectRoute('export async function GET() { await appendAudit(tx, event); }')[0].auditCallDetected).toBe(true);
    expect(inspectRoute('export async function POST() { await closeClinicalVisit(tx); }', { closeClinicalVisit: 'await appendAudit(tx, event)' })[0].auditCallDetected).toBe(true);
  });
  it("fails if the control or delegated audit is removed", () => {
    expect(inspectRoute('export async function GET() { await recordDisclosure(actor); }')[0].auditCallDetected).toBe(true);
    expect(inspectRoute('export async function GET() { return data; }')[0].auditCallDetected).toBe(false);
    expect(inspectRoute('export async function POST() { await closeClinicalVisit(tx); }', { closeClinicalVisit: 'return data' })[0].auditCallDetected).toBe(false);
  });
});

import { createHash } from "node:crypto";
import { reviewMatches } from "./audit-coverage.mjs";
it("invalidates a review when a previously exempt endpoint changes", () => {
  const source = 'export async function GET() { return { status: "blocked" }; }';
  const review = { sourceSha256: createHash("sha256").update(source).digest("hex") };
  expect(reviewMatches(source, review)).toBe(true);
  expect(reviewMatches(source + '\n// changed', review)).toBe(false);
  expect(reviewMatches(source, undefined)).toBe(false);
});
it("follows the audited response helper and detects its removed audit", () => {
  const route = 'export async function GET() { return await auditedOperationalJson(actor, "staff", body); }';
  expect(inspectRoute(route, { auditedOperationalJson: 'await recordDisclosure(actor); return privateJson(body);' })[0].auditCallDetected).toBe(true);
  expect(inspectRoute(route, { auditedOperationalJson: 'return privateJson(body);' })[0].auditCallDetected).toBe(false);
});
