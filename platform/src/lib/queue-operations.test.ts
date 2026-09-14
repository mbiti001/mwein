import { describe, expect, it } from "vitest";
import { percentile, queueDurationMinutes, queueSortValue } from "./queue-operations";

describe("queue operations", () => {
  it("orders urgency before arrival time", () => {
    expect(queueSortValue("URGENT", "2026-09-14T10:00:00Z"))
      .toBeLessThan(queueSortValue("ROUTINE", "2026-09-14T08:00:00Z"));
  });

  it("calculates safe durations and nearest-rank percentiles", () => {
    expect(queueDurationMinutes("2026-09-14T10:00:00Z", "2026-09-14T10:17:30Z")).toBe(17);
    expect(queueDurationMinutes("2026-09-14T11:00:00Z", "2026-09-14T10:00:00Z")).toBe(0);
    expect(percentile([5, 20, 10, 40], 0.9)).toBe(40);
    expect(percentile([], 0.9)).toBe(0);
  });
});
