import { describe, expect, it } from "vitest";
import { duplicatePatientGroups } from "./data-quality";

describe("patient duplicate candidates", () => {
  it("groups matching normalized contacts without merging records", () => {
    const groups = duplicatePatientGroups([{ id: "1", normalizedName: "amina", dateOfBirth: null, contacts: [{ value: "+254 700" }] }, { id: "2", normalizedName: "different", dateOfBirth: null, contacts: [{ value: "+254700" }] }]);
    expect(groups).toEqual([{ key: "contact:254700", patientIds: ["1", "2"] }]);
  });
});
