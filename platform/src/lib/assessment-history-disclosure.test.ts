import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/disclosure-audit", () => ({ recordDisclosure: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { servicePointRecord: { findFirst: vi.fn() }, servicePointRevision: { findMany: vi.fn() } } }));
import { requirePermission } from "./auth";
import { recordDisclosure } from "./disclosure-audit";
import { db } from "./db";
import { GET } from "@/app/api/service-points/history/route";

const visitId = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const actor = { id: "actor", facilityId: "facility", sessionId: "current-session" };
const get = (suffix = "", base = `visitId=${visitId}&recordId=${recordId}`) => GET(new Request(`http://localhost/api/service-points/history?${base}${suffix}`));
const snapshot = (version: number) => ({
  id: `snapshot-${version}`, version, previousVersion: version === 1 ? null : version - 1,
  kind: version === 1 ? "MIGRATION_BASELINE" : "DRAFT_SAVE", servicePoint: "WALK_IN", templateVersion: "KE-WALKIN-1.0",
  data: { carePlan: `Saved private plan ${version}`, reviewed: false, missing: "" }, riskLevel: null, followUpAt: null,
  sourceCreatedAt: new Date("2026-10-20T00:00:00Z"), sourceUpdatedAt: new Date("2026-10-21T00:00:00Z"), capturedAt: new Date("2026-10-22T00:00:00Z"),
  sessionId: version === 1 ? null : "historical-session", recordedBy: { id: "recorder", displayName: "Saved recorder" },
});
let rows: ReturnType<typeof snapshot>[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(actor as any);
  vi.mocked(db.servicePointRecord.findFirst).mockResolvedValue({ id: recordId, encounterId: "encounter" } as any);
  rows = Array.from({ length: 23 }, (_, i) => snapshot(23 - i));
  vi.mocked(db.servicePointRevision.findMany).mockImplementation((async (args: any) => rows.filter(r => args.where.version === undefined || r.version < args.where.version.lt).slice(0, args.take)) as any);
});

describe("authorized structured assessment history pages", () => {
  it("returns twenty complete snapshots, audits their IDs, and withholds the sentinel and session identifiers", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ visitId, recordId, encounterId: "encounter", limit: 20, hasMore: true, nextBeforeVersion: 4, coverage: "RETAINED_SNAPSHOTS_ONLY" });
    expect(body.items).toHaveLength(20);
    const { sessionId: _sessionId, ...expected } = snapshot(23);
    expect(body.items[0]).toMatchObject({ ...expected, sourceCreatedAt: "2026-10-20T00:00:00.000Z", sourceUpdatedAt: "2026-10-21T00:00:00.000Z", capturedAt: "2026-10-22T00:00:00.000Z", sessionAttribution: "RECORDED" });
    expect(body.items[0]).not.toHaveProperty("sessionId");
    expect(JSON.stringify(body)).not.toContain("historical-session");
    expect(JSON.stringify(body)).not.toContain("snapshot-3\"");
    expect(recordDisclosure).toHaveBeenCalledWith(actor, "SERVICE_POINTS", [visitId, recordId, ...rows.slice(0, 20).map(r => r.id)]);
    expect(requirePermission).toHaveBeenCalledWith("encounter.write");
  });
  it("binds the record and every history page to the requested visit and authenticated facility", async () => {
    await get("&beforeVersion=4");
    expect(db.servicePointRecord.findFirst).toHaveBeenCalledWith({ where: { id: recordId, encounter: { visitId, visit: { facilityId: actor.facilityId }, status: { in: ["DRAFT", "SIGNED", "CORRECTED"] } } }, select: { id: true, encounterId: true } });
    expect(db.servicePointRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recordId, encounterId: "encounter", visitId, facilityId: actor.facilityId, version: { lt: 4 } }, orderBy: { version: "desc" }, take: 21 }));
  });
  it("pages without duplicates or lost older versions when a newer version arrives", async () => {
    const first = await (await get()).json();
    rows.unshift(snapshot(24));
    const second = await (await get(`&beforeVersion=${first.nextBeforeVersion}`)).json();
    expect(second.items.map((r: any) => r.version)).toEqual([3, 2, 1]);
    expect(second).toMatchObject({ hasMore: false, nextBeforeVersion: null });
    expect(new Set([...first.items, ...second.items].map(r => r.version)).size).toBe(23);
    expect(second.items[2]).toMatchObject({ kind: "MIGRATION_BASELINE", previousVersion: null, sessionAttribution: "NOT_AVAILABLE", data: snapshot(1).data });
  });
  it("distinguishes no retained snapshots from the end of an older page", async () => {
    rows = [];
    expect(await (await get()).json()).toMatchObject({ items: [], coverage: "NO_RETAINED_SNAPSHOTS", hasMore: false, nextBeforeVersion: null });
    expect(await (await get("&beforeVersion=1")).json()).toMatchObject({ items: [], coverage: "RETAINED_SNAPSHOTS_ONLY", hasMore: false, nextBeforeVersion: null });
    expect(recordDisclosure).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])("denies unauthenticated or unauthorized/MFA-gated reads (%s) before data access", async status => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await get()).status).toBe(status);
    expect(db.servicePointRecord.findFirst).not.toHaveBeenCalled();
    expect(db.servicePointRevision.findMany).not.toHaveBeenCalled();
    expect(recordDisclosure).not.toHaveBeenCalled();
  });
  it("returns indistinguishable not-found for foreign visit/record/facility without querying history", async () => {
    vi.mocked(db.servicePointRecord.findFirst).mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("items");
    expect(db.servicePointRevision.findMany).not.toHaveBeenCalled();
  });
  it.each(["&beforeVersion=0", "&beforeVersion=-1", "&beforeVersion=1.5", "&beforeVersion=2147483648", "&beforeVersion=1e2", "&beforeVersion=", "&beforeVersion=01", "&beforeVersion=1&beforeVersion=2", "&limit=1000", "&facilityId=foreign", `&visitId=${visitId}`])("rejects malformed/ambiguous query %s without reading", async suffix => {
    expect((await get(suffix)).status).toBe(422);
    expect(db.servicePointRecord.findFirst).not.toHaveBeenCalled();
    expect(db.servicePointRevision.findMany).not.toHaveBeenCalled();
  });
  it.each(["", `visitId=${visitId}`, `visitId=invalid&recordId=${recordId}`])("requires well-formed record and visit IDs (%s)", async base => {
    expect((await get("", base)).status).toBe(422);
    expect(db.servicePointRecord.findFirst).not.toHaveBeenCalled();
  });
  it("withholds saved values if disclosure retention fails, with no retry", async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error("Synthetic audit failure"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toContain("Saved private plan");
    expect(recordDisclosure).toHaveBeenCalledTimes(1);
  });
  it("does not claim empty history when database reading fails", async () => {
    vi.mocked(db.servicePointRevision.findMany).mockRejectedValue(new Error("Synthetic read failure"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("items");
    expect(recordDisclosure).not.toHaveBeenCalled();
  });
});
