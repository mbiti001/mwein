import { describe, expect, it } from "vitest";
import { patientTrendRows, type TrendVisit } from "./PatientTrends";

const visit = (id: string, value: string, unit = "kg", status = "COMPLETED"): TrendVisit => ({ id, status, arrivedAt: `2026-09-${id}T10:00:00Z`, triage: { observations: [{ code: "WEIGHT", valueDecimal: value, unit }] } });
describe("patient measurement comparisons", () => {
  it("sorts newest first without mixing units, missing values or cancelled visits", () => {
    const rows = patientTrendRows([visit("01", "70"), visit("02", "71"), visit("03", "150", "lb"), visit("04", ""), visit("05", "99", "kg", "CANCELLED")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].points.map(point => point.value)).toEqual([71, 70]);
  });
  it("excludes unverified and nonnumeric laboratory results", () => {
    const lab = (id: string, status: string, value: string): TrendVisit => ({ id, arrivedAt: `2026-09-${id}T10:00:00Z`, orders: [{ displayName: "Glucose", laboratory: { result: { status, items: [{ analyte: "Glucose", unit: "mmol/L", value }] } } }] });
    const rows = patientTrendRows([lab("01", "VERIFIED", "4.5"), lab("02", "VERIFIED", "5.2"), lab("03", "DRAFT", "12"), lab("04", "VERIFIED", ">20")]);
    expect(rows[0].points.map(point => point.value)).toEqual([5.2, 4.5]);
  });
});
