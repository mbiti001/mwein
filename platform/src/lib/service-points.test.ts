import { describe, expect, it } from "vitest";
import { activeServiceTasks, currentServicePoint, isWaitingOverdue, servicePointCounts, waitingMinutes } from "./service-points";

const patient = { fullName: "Test Patient", patientNumber: "P-1" };

describe("service point mapping", () => {
  it("uses the active queue as the source of truth", () => {
    expect(currentServicePoint({ id: "1", status: "AWAITING_RESULTS", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient, queues: [{ servicePoint: "IMAGING", status: "WAITING" }] })).toBe("IMAGING");
  });

  it("falls back to the visit status for older records", () => {
    expect(currentServicePoint({ id: "1", status: "AWAITING_PAYMENT", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient })).toBe("BILLING");
  });

  it("summarizes queues and calculates non-negative waiting time", () => {
    const visits = [{ id: "1", status: "AWAITING_TRIAGE", priority: "ROUTINE", arrivedAt: "2026-09-03T06:00:00Z", patient }];
    expect(servicePointCounts(visits).TRIAGE).toBe(1);
    expect(waitingMinutes(visits[0], new Date("2026-09-03T06:15:00Z"))).toBe(15);
  });

  it("escalates emergency and urgent waits sooner than routine queues", () => {
    expect(isWaitingOverdue("EMERGENCY", 1)).toBe(true);
    expect(isWaitingOverdue("URGENT", 9)).toBe(false);
    expect(isWaitingOverdue("ROUTINE", 30)).toBe(true);
  });
});

const now = new Date("2026-09-25T09:00:00Z");
const parallel = { id: "parallel", status: "AWAITING_RESULTS", priority: "URGENT", arrivedAt: "2026-09-25T07:00:00Z", patient,
  queues: [
    { servicePoint: "PHARMACY", status: "WAITING", enteredAt: "2026-09-25T08:55:00Z" },
    { servicePoint: "LABORATORY", status: "IN_PROGRESS", enteredAt: "2026-09-25T08:30:00Z" },
    { servicePoint: "IMAGING", status: "CALLED", enteredAt: "2026-09-25T08:45:00Z" },
  ] };
it("preserves all parallel department tasks and their individual waiting clocks", () => {
  expect(activeServiceTasks(parallel, now).map(t => [t.point, t.wait, t.status])).toEqual([
    ["PHARMACY", 5, "WAITING"], ["LABORATORY", 30, "IN_PROGRESS"], ["IMAGING", 15, "CALLED"],
  ]);
  expect(servicePointCounts([parallel])).toMatchObject({ PHARMACY: 1, LABORATORY: 1, IMAGING: 1 });
});
it("ignores historical entries and deduplicates a department using its earliest active arrival", () => {
  const tasks = activeServiceTasks({ ...parallel, queues: [...parallel.queues,
    { servicePoint: "LABORATORY", status: "WAITING", enteredAt: "2026-09-25T08:40:00Z" },
    { servicePoint: "TRIAGE", status: "COMPLETED", enteredAt: "2026-09-25T07:00:00Z" },
  ] }, now);
  expect(tasks).toHaveLength(3); expect(tasks.find(t => t.point === "LABORATORY")?.wait).toBe(30);
});
it("keeps an explicit billing task after clinical closure without reopening clinical care", () => {
  const visit = { ...parallel, status: "DISCHARGED", clinicallyClosedAt: now.toISOString(), queues: [...parallel.queues, { servicePoint: "BILLING", status: "WAITING" }] };
  expect(activeServiceTasks(visit, now).map(t => t.point)).toEqual(["BILLING"]);
  expect(activeServiceTasks({ ...visit, status: "COMPLETED" }, now)).toEqual([]);
  expect(activeServiceTasks({ ...visit, status: "CANCELLED" }, now)).toEqual([]);
});
it("does not invent clinical work for a closed visit with no active billing task", () => {
  expect(activeServiceTasks({ ...parallel, clinicallyClosedAt: now.toISOString() }, now)).toEqual([]);
});
