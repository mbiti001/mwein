import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/audit", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/clinical-access", () => ({ recordClinicalAccess: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { patient: { findFirst: vi.fn() }, $transaction: vi.fn() } }));

import { requirePermission } from "@/lib/auth";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { POST } from "./route";

const user = { id: "registration-staff", facilityId: "facility-a", sessionId: "session-a" };
const base = { givenName: "Synthetic", familyName: "Registration", phone: "0700000000", county: "Nairobi", subcounty: "Westlands", treatmentConsent: true, electronicRecordConsent: true };
const modes = [
  { ...base, registrationMode: "STANDARD" },
  { ...base, registrationMode: "GUARDIAN_ASSISTED", representativeName: "Synthetic Guardian", representativeRelationship: "Parent" },
  { registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS", emergencyReason: "Synthetic patient cannot provide identity" },
];
const send = (body: object) => POST(new Request("http://localhost/api/patients", { method: "POST", body: JSON.stringify(body) }));
let tx: any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(user as any);
  vi.mocked(db.patient.findFirst).mockResolvedValue(null);
  tx = {
    facility: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: user.facilityId, code: "TEST" }) },
    referenceSequence: { upsert: vi.fn().mockResolvedValue({ nextValue: 2n }) },
    patient: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "synthetic-patient", ...data })) },
  };
  vi.mocked(db.$transaction).mockImplementation(async (work: any) => work(tx));
});

for (const mode of modes) describe(`${mode.registrationMode} registration age validation`, () => {
  it.each(["", "  ", null, false, true, [], [0], [30], {}, "unknown", -1, 121, 1.5].map(value => ({ value })))("rejects malformed estimated age $value before queries or writes", async ({ value: estimatedAgeYears }) => {
    const response = await send({ ...mode, estimatedAgeYears });
    expect(response.status).toBe(422);
    expect((await response.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["estimatedAgeYears"] })]));
    expect(db.patient.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.patient.create).not.toHaveBeenCalled();
    expect(appendAudit).not.toHaveBeenCalled();
  });

  it.each([0, "0", 30, "30"])("retains an explicit estimated age %j without changing its value", async estimatedAgeYears => {
    const response = await send({ ...mode, estimatedAgeYears });
    expect(response.status).toBe(201);
    expect(tx.patient.create.mock.calls[0][0].data).toMatchObject({ estimatedAgeYears: Number(estimatedAgeYears), dateOfBirth: null, registrationMode: mode.registrationMode, facilityId: user.facilityId });
    expect((await response.json()).patient.estimatedAgeYears).toBe(Number(estimatedAgeYears));
  });
});

it("checks registration permission before any patient or sequence access", async () => {
  vi.mocked(requirePermission).mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  expect((await send({ ...base, nationalId: "SYNTHETIC-ID", estimatedAgeYears: 30 })).status).toBe(403);
  expect(requirePermission).toHaveBeenCalledWith("patient.create");
  expect(db.patient.findFirst).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(tx.referenceSequence.upsert).not.toHaveBeenCalled();
});

it("retains a supplied date of birth while leaving the omitted estimated age unset", async () => {
  const response = await send({ ...base, dateOfBirth: "2000-04-12" });
  expect(response.status).toBe(201);
  const saved = tx.patient.create.mock.calls[0][0].data;
  expect(saved.dateOfBirth).toEqual(new Date("2000-04-12"));
  expect(saved.estimatedAgeYears).toBeUndefined();
  expect(db.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: user.facilityId, active: true }) }));
});

it("allows emergency registration without inventing an age or date of birth", async () => {
  const response = await send(modes[2]);
  expect(response.status).toBe(201);
  expect(tx.patient.create.mock.calls[0][0].data).toMatchObject({ dateOfBirth: null, estimatedAgeYears: undefined, identityStatus: "UNIDENTIFIED", restricted: true });
});

it("requires age or date of birth for ordinary and guardian registrations", async () => {
  for (const mode of modes.slice(0, 2)) expect((await send(mode)).status).toBe(422);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("keeps the authenticated facility and actor on registration and its audit event", async () => {
  const response = await send({ ...base, estimatedAgeYears: 30, facilityId: "foreign-facility", recordedById: "foreign-actor" });
  expect(response.status).toBe(201);
  expect(tx.facility.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: user.facilityId } });
  expect(tx.referenceSequence.upsert.mock.calls[0][0].where.facilityId_kind_year).toMatchObject({ facilityId: user.facilityId, kind: "PATIENT" });
  const data = tx.patient.create.mock.calls[0][0].data;
  expect(data.facilityId).toBe(user.facilityId);
  expect(data.consents.create.every((consent: any) => consent.recordedById === user.id)).toBe(true);
  expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: user.id, action: "PATIENT_REGISTERED", entityType: "Patient", entityId: "synthetic-patient" }));
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});

it("withholds success when the registration audit fails inside the transaction", async () => {
  vi.mocked(appendAudit).mockRejectedValue(new Error("Synthetic audit unavailable"));
  const response = await send({ ...base, estimatedAgeYears: 30 });
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("patient");
  expect(tx.patient.create).toHaveBeenCalledTimes(1);
  expect(appendAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "PATIENT_REGISTERED" }));
  // A mocked callback proves the error boundary, not real database rollback.
});
