import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn() } }));
import { requirePermission } from "./auth";
import { appendAudit } from "./audit";
import { db } from "./db";
import { POST } from "@/app/api/encounters/[id]/addenda/route";
import { createHash } from "node:crypto";

const id = "11111111-1111-4111-8111-111111111111";
const user = { id: "actor-a", facilityId: "facility-a", sessionId: "session-a" };
const input = { idempotencyKey: "22222222-2222-4222-8222-222222222222", reason: "Clarify synthetic wording", text: "Synthetic narrative amendment" };
const tx = { encounter: { findFirst: vi.fn() }, encounterAddendum: { findUnique: vi.fn(), create: vi.fn() }, auditEvent: { findFirst: vi.fn() } };
const post = (body: unknown = input) => POST(new Request("http://localhost/api/encounters/test/addenda", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(user as any);
  tx.encounter.findFirst.mockResolvedValue({ id, visitId: "visit-a", status: "SIGNED" });
  tx.encounterAddendum.findUnique.mockResolvedValue(null);
  tx.encounterAddendum.create.mockImplementation(async args => ({ id: "addendum-a", ...args.data, createdAt: new Date("2026-10-20T22:00:00Z"), author: { displayName: "Synthetic Author" } }));
  vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback(tx));
});

describe("assessment narrative amendment audit: existing boundaries", () => {
  it.each([401, 403])("denies %s before starting a transaction", async status => {
    vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await post()).status).toBe(status);
    expect(requirePermission).toHaveBeenCalledWith("encounter.write");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("scopes the signed encounter lookup to the authenticated facility", async () => {
    tx.encounter.findFirst.mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(409);
    expect(tx.encounter.findFirst).toHaveBeenCalledWith({ where: { id, status: "SIGNED", visit: { facilityId: user.facilityId } } });
    expect(tx.encounterAddendum.create).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("addendum");
  });
  it.each([{ reason: " " }, { text: " " }, { reason: "x".repeat(241) }, { text: "x".repeat(5001) }])("rejects invalid amendment input %j", async patch => {
    expect((await post({ ...input, ...patch })).status).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("stamps the authenticated author and ignores submitted identity and structured values", async () => {
    const response = await post({ ...input, authorId: "foreign-author", facilityId: "foreign-facility", encounterId: "foreign-encounter", data: { carePlan: "Do not replace" }, expectedRevision: "untrusted" });
    expect(response.status).toBe(201);
    expect(tx.encounterAddendum.create).toHaveBeenCalledWith({ data: { encounterId: id, authorId: user.id, ...input }, include: { author: { select: { displayName: true } } } });
    expect(await response.json()).toMatchObject({ addendum: { authorId: user.id, author: { displayName: "Synthetic Author" }, ...input } });
  });
  it("withholds success on audit failure; native fixture verifies actual rollback", async () => {
    vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic amendment audit failure"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("addendum");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("narrative addendum evidence and idempotent replay", () => {
  it("binds persisted narrative values to actor, session, facility and visit", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { addendum } = await response.json();
    const digest = createHash("sha256").update(JSON.stringify(["addendum-v1", user.facilityId, "visit-a", addendum.id, id, user.id, addendum.reason, addendum.text, addendum.createdAt])).digest("hex");
    expect(appendAudit).toHaveBeenCalledWith(tx, { userId: user.id, facilityId: user.facilityId, sessionId: user.sessionId, action: "ENCOUNTER_ADDENDUM_ADDED", entityType: "Encounter", entityId: id, reason: input.reason, afterHash: `addendum-v1:${digest}` });
  });
  it("returns the original committed addendum on an exact same-actor retry", async () => {
    const createdAt = new Date("2026-10-20T22:00:00Z");
    const existing = { id: "addendum-a", encounterId: id, authorId: user.id, ...input, createdAt, author: { displayName: "Synthetic Author" } };
    tx.encounterAddendum.findUnique.mockResolvedValue(existing);
    tx.auditEvent.findFirst.mockResolvedValue({ id: "receipt-a" });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, addendum: { ...existing, createdAt: createdAt.toISOString() } });
    expect(tx.encounterAddendum.create).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
    expect(tx.auditEvent.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ facilityId: user.facilityId, userId: user.id, action: "ENCOUNTER_ADDENDUM_ADDED", entityType: "Encounter", entityId: id }), select: { id: true } });
  });
  it("rejects a reused key with altered narrative or a missing audit receipt", async () => {
    const existing = { id: "addendum-a", encounterId: id, authorId: user.id, ...input, createdAt: new Date("2026-10-20T22:00:00Z"), author: { displayName: "Synthetic Author" } };
    tx.encounterAddendum.findUnique.mockResolvedValue(existing);
    expect((await post({ ...input, text: "Different submitted narrative" })).status).toBe(409);
    expect(tx.encounterAddendum.create).not.toHaveBeenCalled();
    tx.auditEvent.findFirst.mockResolvedValue(null);
    expect((await post()).status).toBe(409);
    expect(appendAudit).not.toHaveBeenCalled();
  });
});

it.each([undefined, "not-a-uuid"])("rejects missing or invalid retry key %s", async idempotencyKey => {
  expect((await post({ ...input, idempotencyKey })).status).toBe(422);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it.each(["authorId", "encounterId", "reason", "text"])("rejects a key reused with different %s", async field => {
  tx.encounterAddendum.findUnique.mockResolvedValue({ id: "addendum-a", encounterId: id, authorId: user.id, ...input, [field]: "different", createdAt: new Date() });
  expect((await post()).status).toBe(409);
  expect(appendAudit).not.toHaveBeenCalled();
  expect(tx.encounterAddendum.create).not.toHaveBeenCalled();
});
it.each(["P2034", "P2002"])("retries a known aborted transaction %s with bounded attempts", async code => {
  vi.mocked(db.$transaction).mockRejectedValueOnce({ code });
  expect((await post()).status).toBe(201);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  vi.mocked(db.$transaction).mockReset().mockRejectedValue({ code });
  expect((await post()).status).toBe(409);
  expect(db.$transaction).toHaveBeenCalledTimes(3);
});
it("does not automatically retry an ambiguous network failure", async () => {
  vi.mocked(db.$transaction).mockRejectedValue(new Error("Connection lost"));
  expect((await post()).status).toBe(500);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
