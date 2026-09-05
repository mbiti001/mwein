import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [registeredToday, waiting, visitsToday, activeStaff, openInvoices, pendingClaims, pendingOrders, sessions, audits, stock] = await Promise.all([
      db.patient.count({ where: { facilityId: user.facilityId, createdAt: { gte: today } } }),
      db.visit.count({ where: { facilityId: user.facilityId, status: { in: ["REGISTERED", "AWAITING_TRIAGE", "AWAITING_CLINICIAN", "UNDER_CONSULTATION", "ORDERS_PENDING", "AWAITING_RESULTS", "AWAITING_PHARMACY", "AWAITING_PAYMENT"] } } }),
      db.visit.count({ where: { facilityId: user.facilityId, createdAt: { gte: today } } }),
      db.user.count({ where: { facilityId: user.facilityId, status: "ACTIVE" } }),
      db.invoice.findMany({ where: { visit: { facilityId: user.facilityId }, status: { in: ["OPEN", "READY", "PART_PAID"] } }, include: { items: true, payments: { where: { status: "CONFIRMED" } } } }),
      db.claim.count({ where: { invoice: { visit: { facilityId: user.facilityId } }, status: { in: ["DRAFT", "REJECTED"] } } }),
      db.purchaseOrder.count({ where: { facilityId: user.facilityId, status: "SUBMITTED" } }),
      db.session.findMany({ where: { user: { facilityId: user.facilityId }, expiresAt: { gt: new Date() } }, include: { user: { select: { displayName: true, email: true } } }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
      db.auditEvent.findMany({ where: { user: { facilityId: user.facilityId } }, include: { user: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 40 }),
      db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: { name: true, reorderLevel: true, inventoryBatches: { where: { active: true }, select: { quantityAvailable: true, expiryDate: true } } } }),
    ]);
    const outstanding = openInvoices.reduce((sum, invoice) => sum + invoice.items.reduce((value, item) => value + Number(item.quantity) * Number(item.unitPrice), 0) - invoice.payments.reduce((value, payment) => value + Number(payment.amount), 0), 0);
    const inNinetyDays = new Date(Date.now() + 90 * 86400000);
    const lowStock = stock.filter(item => item.reorderLevel != null && item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0) <= Number(item.reorderLevel));
    const expiringStock = stock.filter(item => item.inventoryBatches.some(batch => batch.expiryDate <= inNinetyDays && Number(batch.quantityAvailable) > 0));
    return NextResponse.json({ metrics: { registeredToday, waiting, visitsToday, activeStaff, outstanding, pendingClaims, pendingOrders, lowStock: lowStock.length, expiringStock: expiringStock.length, activeSessions: sessions.length }, actionItems: { lowStock: lowStock.map(item => item.name), expiringStock: expiringStock.map(item => item.name) }, sessions, audits });
  } catch (error) { return apiError(error); }
}
