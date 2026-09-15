import { describe, expect, it } from "vitest";
import { applyLnmpDating, dateInTimeZone, gestationalAgeLabel, pregnancyDatingFromLnmp } from "./pregnancy-dating";

describe("LNMP pregnancy dating", () => {
  it("calculates EDD using the 280-day rule", () => {
    expect(pregnancyDatingFromLnmp("2026-01-01", new Date("2026-03-15T18:00:00Z"))).toEqual({
      lnmp: "2026-01-01",
      estimatedDeliveryDate: "2026-10-08",
      gestationalAgeWeeks: 10,
      gestationalAgeDays: 3,
      gestationalAgeTotalDays: 73,
      method: "LNMP",
    });
  });

  it("handles leap-year dates with UTC calendar arithmetic", () => {
    expect(pregnancyDatingFromLnmp("2024-02-29", new Date("2024-03-07T23:59:59Z"))?.estimatedDeliveryDate).toBe("2024-12-05");
  });

  it("rejects invalid and future LNMP dates", () => {
    expect(pregnancyDatingFromLnmp("2026-02-30", new Date("2026-03-01T00:00:00Z"))).toBeNull();
    expect(pregnancyDatingFromLnmp("2026-03-02", new Date("2026-03-01T00:00:00Z"))).toBeNull();
  });

  it("applies the same canonical values to structured ANC data", () => {
    const result = applyLnmpDating({ lmp: "2026-01-01", edd: "wrong", gestationWeeks: "99" }, new Date("2026-03-15T00:00:00Z"));
    expect(result.data).toMatchObject({ edd: "2026-10-08", gestationWeeks: "10", gestationDays: "3", datingMethod: "LNMP" });
    expect(gestationalAgeLabel(result.dating!)).toBe("10 weeks 3 days");
  });

  it("uses the facility calendar date instead of the server UTC date", () => {
    expect(dateInTimeZone(new Date("2026-03-14T21:30:00Z"), "Africa/Nairobi")).toBe("2026-03-15");
  });
});
