import type { Prisma, Priority } from "@prisma/client";

const active = ["WAITING", "CALLED", "IN_PROGRESS"] as const;
const open = ["DRAFT", "REQUESTED", "IN_PROGRESS"];

// Call inside a serializable transaction: concurrent department completions must
// see each other's orders before deciding which team owns the next task.
export async function ensureServiceTask(tx: Prisma.TransactionClient, visit: { id: string; priority: Priority }, servicePoint: string) {
  const existing = await tx.queueEntry.findFirst({ where: { visitId: visit.id, servicePoint, status: { in: [...active] } } });
  if (!existing) await tx.queueEntry.create({ data: { visitId: visit.id, servicePoint, priority: visit.priority } });
}

export async function advanceAfterService(tx: Prisma.TransactionClient, facilityId: string, visitId: string, service: "LABORATORY" | "IMAGING" | "PHARMACY") {
  const visit = await tx.visit.findFirst({ where: { id: visitId, facilityId }, include: { encounters: true, orders: true } });
  if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
  if (visit.clinicallyClosedAt || ["DISCHARGED", "COMPLETED", "CANCELLED"].includes(visit.status)) return;
  const pending = visit.orders.filter(order => open.includes(order.status));
  const type = service === "PHARMACY" ? "MEDICATION" : service;
  if (!pending.some(order => order.type === type)) await tx.queueEntry.updateMany({
    where: { visitId, servicePoint: service, status: { in: [...active] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  // Department work cannot discharge an admission or invent an inpatient workflow.
  if (visit.status === "ADMITTED") return;
  if (pending.some(order => ["LABORATORY", "IMAGING"].includes(order.type))) {
    await tx.visit.update({ where: { id: visitId }, data: { status: "AWAITING_RESULTS" } });
    return;
  }
  const signed = visit.encounters.some(encounter => ["SIGNED", "CORRECTED"].includes(encounter.status));
  if (!signed) {
    await ensureServiceTask(tx, visit, "CONSULTATION");
    if (visit.status !== "UNDER_CONSULTATION") await tx.visit.update({ where: { id: visitId }, data: { status: "AWAITING_CLINICIAN" } });
    return;
  }
  const medicines = pending.some(order => order.type === "MEDICATION");
  await ensureServiceTask(tx, visit, medicines ? "PHARMACY" : "BILLING");
  await tx.visit.update({ where: { id: visitId }, data: { status: medicines ? "AWAITING_PHARMACY" : "AWAITING_PAYMENT" } });
}
