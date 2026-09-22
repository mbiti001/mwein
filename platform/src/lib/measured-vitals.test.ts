import { describe, expect, it } from "vitest";
import { measuredValuesSchema, measuredVitalsSchema } from "./measured-vitals";
describe("measured vitals without clinical triage", () => {
  it("accepts partial measured values without invented normal defaults", () => {
    expect(measuredValuesSchema.parse({ temperatureC: 37.1 })).toEqual({ temperatureC: 37.1 });
    expect(measuredValuesSchema.safeParse({}).success).toBe(false);
    expect(measuredValuesSchema.safeParse({ pulseBpm: "" }).success).toBe(false);
    expect(measuredValuesSchema.safeParse({ pulseBpm: null }).success).toBe(false);
  });
  it("rejects partial blood pressure, invalid numbers and clinical fields", () => {
    for (const value of [{ systolicBp: 120 }, { pulseBpm: 80.5 }, { oxygenSaturation: 110 }, { weightKg: 0 }, { temperatureC: 37, triageCategory: "ROUTINE" }]) expect(measuredValuesSchema.safeParse(value).success).toBe(false);
    expect(measuredValuesSchema.safeParse({ systolicBp: 120, diastolicBp: 80 }).success).toBe(true);
  });
  it("rejects future measurement times and unsupported workflow mutations", () => {
    const payload = { measuredAt: "2026-01-01T10:00:00Z", values: { weightKg: 70 } };
    expect(measuredVitalsSchema.safeParse(payload).success).toBe(true);
    expect(measuredVitalsSchema.safeParse({ ...payload, measuredAt: "2100-01-01T00:00:00Z" }).success).toBe(false);
    expect(measuredVitalsSchema.safeParse({ ...payload, status: "AWAITING_CLINICIAN" }).success).toBe(false);
  });
});
