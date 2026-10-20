import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), anchor: vi.fn(), visits: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/db", () => ({ db: { visit: { findFirst: mocks.anchor, findMany: mocks.visits } } }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: mocks.audit }));

import { GET } from "./route";

const actor = { id: "user", facilityId: "facility-a", sessionId: "session" };
const cursor = "82b86089-66d9-4f38-af31-8dcc7310160d";
const arrival = new Date("2026-09-01T08:00:00.000Z");
const visit = {
  id: cursor, visitNumber: "MMS-V-0001", clinic: "General outpatient", priority: "ROUTINE",
  status: "AWAITING_CLINICIAN", arrivedAt: arrival, clinicallyClosedAt: null,
  patient: { id: "patient-a", fullName: "Synthetic Patient", patientNumber: "MMS-P-0001" },
};

function request(query = "") {
  return GET(new Request(`https://test/api/visits/cancellation-worklist${query}`));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(actor);
  mocks.anchor.mockResolvedValue({ id: cursor, arrivedAt: arrival });
  mocks.visits.mockResolvedValue([visit]);
});

describe("visit cancellation worklist", () => {
  it("lists older active visits across service points using only facility-scoped operational identity", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("visit.cancel");
    expect(mocks.visits).toHaveBeenCalledWith({
      where: { facilityId: "facility-a", status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: {
        id: true, visitNumber: true, clinic: true, priority: true, status: true,
        arrivedAt: true, clinicallyClosedAt: true,
        patient: { select: { id: true, fullName: true, patientNumber: true } },
      },
      orderBy: [{ arrivedAt: "asc" }, { id: "asc" }], take: 51,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ visits: [{ ...visit, arrivedAt: arrival.toISOString() }], nextCursor: null });
    expect(mocks.audit).toHaveBeenCalledWith(actor, "VISIT_WORKLIST", [
      { type: "Visit", id: cursor }, { type: "Patient", id: "patient-a" },
    ]);
  });

  it("searches patient names, patient numbers, visits and clinics in the database before pagination", async () => {
    const response = await request("?q=%20MMS-P-0001%20");
    expect(response.status).toBe(200);
    expect(mocks.visits).toHaveBeenCalledWith(expect.objectContaining({ where: {
      facilityId: "facility-a", status: { notIn: ["COMPLETED", "CANCELLED"] },
      AND: [{ OR: [
        { visitNumber: { contains: "MMS-P-0001", mode: "insensitive" } },
        { clinic: { contains: "MMS-P-0001", mode: "insensitive" } },
        { patient: { fullName: { contains: "MMS-P-0001", mode: "insensitive" } } },
        { patient: { patientNumber: { contains: "MMS-P-0001", mode: "insensitive" } } },
      ] }],
    } }));
  });

  it("returns 50 rows and a continuation cursor while auditing only the disclosed page", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...visit, id: `visit-${index}` }));
    mocks.visits.mockResolvedValue(rows);
    const response = await request();
    const body = await response.json();
    expect(body.visits).toHaveLength(50);
    expect(body.nextCursor).toBe("visit-49");
    expect(mocks.audit.mock.calls[0][2]).toHaveLength(100);
    expect(mocks.audit.mock.calls[0][2]).not.toContainEqual({ type: "Visit", id: "visit-50" });
  });

  it("continues after a cursor with the same tenant and search restrictions", async () => {
    mocks.visits.mockResolvedValue([]);
    const response = await request(`?cursor=${cursor}&q=Outpatient`);
    expect(mocks.visits).toHaveBeenCalledWith(expect.objectContaining({
      take: 51,
      where: {
        facilityId: "facility-a", status: { notIn: ["COMPLETED", "CANCELLED"] },
        AND: [
          { OR: [
            { visitNumber: { contains: "Outpatient", mode: "insensitive" } },
            { clinic: { contains: "Outpatient", mode: "insensitive" } },
            { patient: { fullName: { contains: "Outpatient", mode: "insensitive" } } },
            { patient: { patientNumber: { contains: "Outpatient", mode: "insensitive" } } },
          ] },
          { OR: [{ arrivedAt: { gt: arrival } }, { arrivedAt: arrival, id: { gt: cursor } }] },
        ],
      },
    }));
    expect(mocks.visits.mock.calls[0][0]).not.toHaveProperty("skip");
    expect(mocks.visits.mock.calls[0][0]).not.toHaveProperty("cursor");
    expect(await response.json()).toEqual({ visits: [], nextCursor: null });
    expect(mocks.audit).toHaveBeenCalledWith(actor, "VISIT_WORKLIST", []);
  });

  it("keeps the first eligible row after an anchor that was cancelled between page requests", async () => {
    const next = { ...visit, id: "82b86089-66d9-4f38-af31-8dcc7310160e" };
    const later = { ...visit, id: "82b86089-66d9-4f38-af31-8dcc7310160f", arrivedAt: new Date(arrival.getTime() + 1000) };
    const stored = [
      { ...visit, id: "82b86089-66d9-4f38-af31-8dcc7310160c" },
      { ...visit, status: "CANCELLED" },
      next, later,
    ];
    mocks.anchor.mockImplementation(({ where }) => {
      const found = stored.find(row => row.id === where.id && (!where.status || row.status === where.status));
      return found ? { id: found.id, arrivedAt: found.arrivedAt } : null;
    });
    mocks.visits.mockImplementation(({ where, skip = 0 }) => {
      const bounds = where.AND[0].OR;
      return stored.filter(row => !where.status.notIn.includes(row.status)
        && (row.arrivedAt > bounds[0].arrivedAt.gt
          || (row.arrivedAt.getTime() === bounds[1].arrivedAt.getTime() && row.id > bounds[1].id.gt)))
        .slice(skip);
    });
    const response = await request(`?cursor=${cursor}`);
    expect(response.status).toBe(200);
    expect((await response.json()).visits.map((row: { id: string }) => row.id)).toEqual([next.id, later.id]);
    expect(mocks.anchor).toHaveBeenCalledWith({
      where: { id: cursor, facilityId: "facility-a" }, select: { id: true, arrivedAt: true },
    });
    expect(mocks.visits.mock.calls[0][0].orderBy).toEqual([{ arrivedAt: "asc" }, { id: "asc" }]);
  });

  it.each(["missing", "another facility"])("rejects a cursor from %s without reading or disclosing a page", async () => {
    mocks.anchor.mockResolvedValue(null);
    const response = await request(`?cursor=${cursor}`);
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("visits");
    expect(mocks.anchor).toHaveBeenCalledWith({
      where: { id: cursor, facilityId: "facility-a" }, select: { id: true, arrivedAt: true },
    });
    expect(mocks.visits).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(["?cursor=not-a-uuid", `?q=${"x".repeat(101)}`])("rejects invalid query %s before accessing records", async query => {
    expect((await request(query)).status).toBe(422);
    expect(mocks.anchor).not.toHaveBeenCalled();
    expect(mocks.visits).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("denies callers without cancellation permission before reading records", async () => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("Permission denied"), { status: 403 }));
    expect((await request()).status).toBe(403);
    expect(mocks.anchor).not.toHaveBeenCalled();
    expect(mocks.visits).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not disclose visits if the required access audit fails", async () => {
    mocks.audit.mockRejectedValue(new Error("Audit unavailable"));
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("visits");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
