import { describe, expect, it } from "vitest";
import { patientRegistrationSchema } from "./domain";
import { registrationFormPayload } from "./registration-input";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const emergency = {
  registrationMode: "EMERGENCY_UNKNOWN", lawfulBasis: "VITAL_INTERESTS",
  emergencyReason: "Synthetic patient cannot provide identity", sexAtBirth: "UNKNOWN",
};
const known = {
  givenName: "Synthetic", familyName: "Patient", phone: "0700000000",
  county: "Busia", subcounty: "Nambale", treatmentConsent: "on", electronicRecordConsent: "on",
};

describe("registration form serialization", () => {
  it("leaves unselected emergency sex unknown without weakening other routes", () => {
    const payload = registrationFormPayload(form({ ...emergency, sexAtBirth: "" }));
    expect(payload).not.toHaveProperty("sexAtBirth");
    expect(patientRegistrationSchema.parse(payload).sexAtBirth).toBe("UNKNOWN");
    for (const registrationMode of ["STANDARD", "GUARDIAN_ASSISTED"]) {
      const invalid = registrationFormPayload(form({ ...known, registrationMode, estimatedAgeYears: "30", sexAtBirth: "" }));
      expect(invalid.sexAtBirth).toBe("");
      expect(patientRegistrationSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it.each(["", "   ", "\t\n"])("omits unavailable emergency demographics represented by %j", blank => {
    const payload = registrationFormPayload(form({ ...emergency,
      givenName: blank, middleName: blank, familyName: blank, fullName: blank,
      dateOfBirth: blank, estimatedAgeYears: blank, phone: blank, alternativePhone: blank,
      nationalId: blank, shaNumber: blank, county: blank, subcounty: blank, ward: blank, village: blank,
      representativeName: blank, representativeRelationship: blank,
    }));
    expect(payload).toEqual({ ...emergency, treatmentConsent: false, electronicRecordConsent: false, messagingConsent: false });
    const parsed = patientRegistrationSchema.parse(JSON.parse(JSON.stringify(payload)));
    expect(parsed.estimatedAgeYears).toBeUndefined();
    expect(parsed.county).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
  });

  for (const registrationMode of ["STANDARD", "GUARDIAN_ASSISTED", "EMERGENCY_UNKNOWN"]) {
    it(`${registrationMode} preserves explicit zero and deliberate identity/contact values`, () => {
      const payload = registrationFormPayload(form({ ...emergency, ...known, registrationMode,
        representativeName: "Synthetic Parent", representativeRelationship: "Parent",
        estimatedAgeYears: "0", dateOfBirth: "", ward: "  Synthetic ward  ", messagingConsent: "on",
      }));
      expect(payload.estimatedAgeYears).toBe("0");
      expect(payload.county).toBe("Busia");
      expect(payload.ward).toBe("  Synthetic ward  ");
      expect(payload).not.toHaveProperty("dateOfBirth");
      expect(payload.messagingConsent).toBe(true);
      expect(patientRegistrationSchema.parse(payload).estimatedAgeYears).toBe(0);
    });
  }

  it("retains date-of-birth-only input without inventing estimated age", () => {
    const payload = registrationFormPayload(form({ ...known, dateOfBirth: "2000-01-01", estimatedAgeYears: "" }));
    expect(patientRegistrationSchema.parse(payload).dateOfBirth).toBe("2000-01-01");
    expect(payload).not.toHaveProperty("estimatedAgeYears");
  });

  it.each(["STANDARD", "GUARDIAN_ASSISTED"])("%s still rejects missing required demographics and consents", registrationMode => {
    const result = patientRegistrationSchema.safeParse(registrationFormPayload(form({ registrationMode,
      givenName: "", familyName: "", phone: "", county: "", subcounty: "", estimatedAgeYears: "",
      representativeName: "", representativeRelationship: "",
    })));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path[0])).toEqual(expect.arrayContaining([
        "givenName", "dateOfBirth", "phone", "county", "subcounty", "treatmentConsent", "electronicRecordConsent",
        ...(registrationMode === "GUARDIAN_ASSISTED" ? ["representativeName", "representativeRelationship"] : []),
      ]));
    }
  });

  it.each([
    ["estimatedAgeYears", "not an age"], ["estimatedAgeYears", "-1"], ["estimatedAgeYears", "121"],
    ["estimatedAgeYears", "0.5"], ["phone", "1"], ["county", "A"], ["subcounty", "A"],
    ["dateOfBirth", "not a date"], ["emergencyReason", "x"],
  ])("does not hide invalid supplied %s = %j", (field, value) => {
    const payload = registrationFormPayload(form({ ...emergency, [field]: value }));
    expect(payload[field]).toBe(value);
    expect(patientRegistrationSchema.safeParse(payload).success).toBe(false);
  });

  it("requires the emergency reason even when blank fields are omitted", () => {
    const payload = registrationFormPayload(form({ ...emergency, emergencyReason: "   " }));
    expect(payload).not.toHaveProperty("emergencyReason");
    expect(patientRegistrationSchema.safeParse(payload).success).toBe(false);
  });

  it("records only checked consent boxes", () => {
    const payload = registrationFormPayload(form({ ...emergency, treatmentConsent: "on", electronicRecordConsent: "false" }));
    expect(payload.treatmentConsent).toBe(true);
    expect(payload.electronicRecordConsent).toBe(false);
    expect(payload.messagingConsent).toBe(false);
  });
});
