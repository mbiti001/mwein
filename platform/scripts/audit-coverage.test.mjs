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
