import { describe, expect, it } from "vitest";
import { clinicalFollowUpDate } from "./follow-ups";

describe("signed plan follow-up dates", () => {
  it("interprets a valid calendar date in the facility timezone", () => {
    expect(clinicalFollowUpDate('{"followUpDate":"2028-02-29"}')).toBe("2028-02-29T00:00:00+03:00");
  });
  it.each([null, "", "broken json", "null", "[]", '{"followUpDate":"2026-02-30"}', '{"followUpDate":"not a date"}', '{"followUpDate":123}', '{"followUpDate":"2026-01-01T00:00:00Z"}'])("excludes invalid or unsupported date data: %s", plan => {
    expect(clinicalFollowUpDate(plan)).toBeNull();
  });
});
