import { describe, expect, it } from "vitest";
import {
  assessTriageVitals,
  assertVisitTransition,
  invoiceLineTotal,
  operationalReference,
  patientClinicalGroup,
  patientNumber,
  patientRegistrationSchema,
  triageSchema,
} from "./domain";
import { parseCsv } from "./csv";

describe("Phase 1 domain rules", () => {
  it("generates stable patient numbers", () =>
    expect(patientNumber("MMS", 2026, 42n)).toBe("MMS-2026-000042"));
  it("generates visit references", () =>
    expect(operationalReference("MMS", "V", 2026, 7n)).toBe(
      "MMS-V-2026-000007",
    ));
  it("permits the normal front-door transition", () =>
    expect(() =>
      assertVisitTransition("REGISTERED", "AWAITING_TRIAGE"),
    ).not.toThrow());
  it("prevents skipping from registration to consultation", () =>
    expect(() =>
      assertVisitTransition("REGISTERED", "UNDER_CONSULTATION"),
    ).toThrow());
  it("calculates money without floating point arithmetic", () =>
    expect(invoiceLineTotal("2.5", "120.00")).toBe(30000n));
  it("requires DOB or estimated age", () => {
    const result = patientRegistrationSchema.safeParse({
      fullName: "Fictional Patient",
      sexAtBirth: "FEMALE",
      phone: "+254700000000",
      county: "Busia",
      subcounty: "Nambale",
      treatmentConsent: true,
      electronicRecordConsent: true,
    });
    expect(result.success).toBe(false);
  });
  it("accepts structured patient names and requires first name plus surname", () => {
    const base = { sexAtBirth: "FEMALE", phone: "+254700000001", county: "Busia", subcounty: "Nambale", estimatedAgeYears: 30, treatmentConsent: true, electronicRecordConsent: true };
    expect(patientRegistrationSchema.safeParse({ ...base, givenName: "Amina", middleName: "Naliaka", familyName: "Wekesa" }).success).toBe(true);
    expect(patientRegistrationSchema.safeParse({ ...base, givenName: "Amina" }).success).toBe(false);
  });
  it("raises critical triage alerts for dangerous observations", () => {
    const alerts = assessTriageVitals({
      temperatureC: 37,
      pulseBpm: 88,
      respiratoryRate: 20,
      systolicBp: 86,
      diastolicBp: 55,
      oxygenSaturation: 87,
      painScore: 3,
      consciousness: "ALERT",
    });
    expect(
      alerts.filter((alert) => alert.severity === "CRITICAL"),
    ).toHaveLength(2);
  });
  it("requires a deliberately recorded presenting concern at triage", () => {
    const observations = {
      temperatureC: 36.8, pulseBpm: 80, respiratoryRate: 18,
      systolicBp: 120, diastolicBp: 75, oxygenSaturation: 98,
      weightKg: 65, painScore: 0, consciousness: "ALERT", triageCategory: "ROUTINE",
    };
    expect(triageSchema.safeParse(observations).success).toBe(false);
    expect(triageSchema.safeParse({ ...observations, chiefComplaint: "Routine review without an immediate red flag" }).success).toBe(true);
  });
  it("does not alert for observations inside configured thresholds", () => {
    expect(
      assessTriageVitals({
        temperatureC: 36.8,
        pulseBpm: 80,
        respiratoryRate: 18,
        systolicBp: 120,
        diastolicBp: 75,
        oxygenSaturation: 98,
        painScore: 2,
        consciousness: "ALERT",
      }),
    ).toEqual([]);
  });
  it("recognises children independently of sex", () => {
    expect(
      patientClinicalGroup(
        { sexAtBirth: "MALE", dateOfBirth: "2018-05-10" },
        new Date("2026-09-02"),
      ),
    ).toMatchObject({
      age: 8,
      ageGroup: "CHILD",
      pregnancyQuestionsApply: false,
    });
  });
  it("shows private pregnancy screening for female adolescents and adults", () => {
    expect(
      patientClinicalGroup({ sexAtBirth: "FEMALE", estimatedAgeYears: 30 })
        .pregnancyQuestionsApply,
    ).toBe(true);
    expect(
      patientClinicalGroup({ sexAtBirth: "FEMALE", estimatedAgeYears: 14 })
        .pregnancyQuestionsApply,
    ).toBe(true);
    expect(
      patientClinicalGroup({ sexAtBirth: "MALE", estimatedAgeYears: 30 })
        .pregnancyQuestionsApply,
    ).toBe(false);
  });
  it("parses quoted spreadsheet values and preserves row numbers", () => {
    expect(parseCsv('full_name,county\n"Patient, Test",Busia')).toEqual([
      { rowNumber: 2, values: { full_name: "Patient, Test", county: "Busia" } },
    ]);
  });
});
