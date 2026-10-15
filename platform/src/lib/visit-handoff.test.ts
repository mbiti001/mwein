import { beforeEach, expect, it, vi } from "vitest";
import { advanceAfterService } from "./visit-handoff";
import { workflowTransaction } from "./workflow-transaction";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("./db", () => ({ db: { $transaction: mocks.transaction } }));
const tx = { visit: { findFirst: vi.fn(), update: vi.fn() }, queueEntry: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } };
const base = { id: "visit", facilityId: "facility", priority: "ROUTINE", status: "AWAITING_PHARMACY", clinicallyClosedAt: null, encounters: [{ status: "SIGNED" }], orders: [{ type: "MEDICATION", status: "COMPLETED" }] };
const advance = (service: "PHARMACY" | "IMAGING" | "LABORATORY" = "PHARMACY") => advanceAfterService(tx as never, "facility", "visit", service);
beforeEach(() => { vi.clearAllMocks(); tx.visit.findFirst.mockResolvedValue(base); tx.queueEntry.findFirst.mockResolvedValue(null); });
it("preserves unfinished diagnostics when pharmacy finishes", async () => {
  tx.visit.findFirst.mockResolvedValue({ ...base, encounters: [{ status: "DRAFT" }], orders: [...base.orders, { type: "IMAGING", status: "IN_PROGRESS" }] });
  await advance();
  expect(tx.visit.update).toHaveBeenCalledWith({ where: { id: "visit" }, data: { status: "AWAITING_RESULTS" } });
  expect(tx.queueEntry.create).not.toHaveBeenCalled();
});
it("returns an unsigned visit to consultation, never payment", async () => {
  tx.visit.findFirst.mockResolvedValue({ ...base, encounters: [{ status: "DRAFT" }] }); await advance();
  expect(tx.queueEntry.create).toHaveBeenCalledWith({ data: { visitId: "visit", priority: "ROUTINE", servicePoint: "CONSULTATION" } });
});
it("keeps partially supplied medicines in pharmacy after clinical signature", async () => {
  tx.visit.findFirst.mockResolvedValue({ ...base, orders: [{ type: "MEDICATION", status: "IN_PROGRESS" }] }); await advance("IMAGING");
  expect(tx.visit.update).toHaveBeenCalledWith({ where: { id: "visit" }, data: { status: "AWAITING_PHARMACY" } });
});
it("moves resolved, signed services to billing without duplicating an active task", async () => {
  tx.queueEntry.findFirst.mockResolvedValue({ id: "existing" }); await advance();
  expect(tx.queueEntry.create).not.toHaveBeenCalled();
  expect(tx.visit.update).toHaveBeenCalledWith({ where: { id: "visit" }, data: { status: "AWAITING_PAYMENT" } });
});
it.each(["ADMITTED", "DISCHARGED", "COMPLETED", "CANCELLED"])("does not replace %s with an outpatient status", async status => {
  tx.visit.findFirst.mockResolvedValue({ ...base, status }); await advance();
  expect(tx.visit.update).not.toHaveBeenCalled(); expect(tx.queueEntry.create).not.toHaveBeenCalled();
});
it("scopes every reconciliation to the authorised facility", async () => {
  tx.visit.findFirst.mockResolvedValue(null); await expect(advance()).rejects.toMatchObject({ status: 404 });
  expect(tx.visit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "visit", facilityId: "facility" } }));
  expect(tx.queueEntry.updateMany).not.toHaveBeenCalled();
});
it("retries concurrent changes, with serializable isolation and a strict bound", async () => {
  mocks.transaction.mockRejectedValue({ code: "P2034" });
  await expect(workflowTransaction(async () => true)).rejects.toMatchObject({ code: "P2034" });
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
it("does not retry an audit or unknown failure", async () => {
  mocks.transaction.mockRejectedValue(new Error("Audit unavailable"));
  await expect(workflowTransaction(async () => true)).rejects.toThrow("Audit unavailable");
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});
