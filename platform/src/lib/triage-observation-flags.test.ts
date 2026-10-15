import { expect, it } from "vitest";
import { assessTriageVitals, triageObservationFlags, type TriageVitals } from "./domain";
const baseline: TriageVitals = { temperatureC: 37, pulseBpm: 80, respiratoryRate: 18, systolicBp: 120, diastolicBp: 75, oxygenSaturation: 98, painScore: 0, consciousness: "ALERT" };
it.each([
  ["temperatureC", 34.9, "TEMP", false], ["temperatureC", 39, "TEMP", false],
  ["pulseBpm", 49, "PULSE", false], ["pulseBpm", 131, "PULSE", false],
  ["respiratoryRate", 9, "RESP_RATE", false], ["respiratoryRate", 31, "RESP_RATE", false],
  ["systolicBp", 89, "BP_SYS", true], ["systolicBp", 180, "BP_SYS", true],
  ["diastolicBp", 120, "BP_DIA", true], ["oxygenSaturation", 89, "SPO2", true],
  ["painScore", 7, "PAIN", false], ["consciousness", "VOICE", "CONSCIOUSNESS", true],
] as const)("flags only the affected observation for %s=%s", (key, value, code, critical) => {
  const values = { ...baseline, [key]: value };
  const flags = triageObservationFlags(values);
  expect(Object.entries(flags).filter(([, flag]) => flag.abnormal).map(([key]) => key)).toEqual([code]);
  expect(flags[code]).toEqual({ abnormal: true, critical });
  expect(assessTriageVitals(values)).toHaveLength(1);
  expect(assessTriageVitals(values)[0].severity).toBe(critical ? "CRITICAL" : "WARNING");
});
it("retains unflagged boundaries without declaring unrelated observations normal clinically", () => {
  const flags = triageObservationFlags({ ...baseline, temperatureC: 35, pulseBpm: 50, respiratoryRate: 10, systolicBp: 90, diastolicBp: 119, oxygenSaturation: 90, painScore: 6 });
  expect(Object.values(flags).every(flag => !flag.abnormal && !flag.critical)).toBe(true);
  expect(assessTriageVitals({ ...baseline, temperatureC: 38.9, pulseBpm: 130, respiratoryRate: 30, systolicBp: 179 })).toEqual([]);
});
it("retains concurrent findings but does not spread flags to other values", () => {
  const values = { ...baseline, temperatureC: 39, oxygenSaturation: 89, painScore: 8 };
  expect(Object.entries(triageObservationFlags(values)).filter(([, flag]) => flag.abnormal).map(([key]) => key)).toEqual(["TEMP", "SPO2", "PAIN"]);
  expect(assessTriageVitals(values).map(alert => alert.severity)).toEqual(["CRITICAL", "WARNING", "WARNING"]);
});
it("keeps one existing high blood pressure alert while flagging both affected components", () => {
  const values = { ...baseline, systolicBp: 180, diastolicBp: 120 };
  expect(assessTriageVitals(values)).toEqual([{ severity: "CRITICAL", message: "Severely elevated blood pressure" }]);
  const flags = triageObservationFlags(values);
  expect(flags.BP_SYS.critical && flags.BP_DIA.critical).toBe(true);
});
