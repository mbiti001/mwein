import { auditedOperationalJson } from "@/lib/audited-json";
import { db } from "@/lib/db";
import { requirePermission, SESSION_IDLE_MS } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { governanceReadiness, productionConfigurationReadiness } from "@/lib/governance";

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const idleCutoff = new Date(Date.now() - SESSION_IDLE_MS);
    const queryStartedAt = Date.now();
    const [registeredToday, waiting, visitsToday, activeStaff, openInvoices, pendingClaims, pendingOrders, sessions, audits, stock, auditHead, governanceEvidence] = await Promise.all([
      db.patient.count({ where: { facilityId: user.facilityId, createdAt: { gte: today } } }),
      db.visit.count({ where: { facilityId: user.facilityId, status: { in: ["REGISTERED", "AWAITING_TRIAGE", "AWAITING_CLINICIAN", "UNDER_CONSULTATION", "ORDERS_PENDING", "AWAITING_RESULTS", "AWAITING_PHARMACY", "AWAITING_PAYMENT"] } } }),
      db.visit.count({ where: { facilityId: user.facilityId, createdAt: { gte: today } } }),
      db.user.count({ where: { facilityId: user.facilityId, status: "ACTIVE" } }),
      db.invoice.findMany({ where: { visit: { facilityId: user.facilityId }, status: { in: ["OPEN", "READY", "PART_PAID"] } }, include: { items: true, payments: { where: { status: "CONFIRMED" } } } }),
      db.claim.count({ where: { invoice: { visit: { facilityId: user.facilityId } }, status: { in: ["DRAFT", "REJECTED"] } } }),
      db.purchaseOrder.count({ where: { facilityId: user.facilityId, status: "SUBMITTED" } }),
      db.session.findMany({ where: { user: { facilityId: user.facilityId }, expiresAt: { gt: new Date() }, lastSeenAt: { gt: idleCutoff } }, include: { user: { select: { displayName: true, email: true } } }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
      db.auditEvent.findMany({ where: { facilityId: user.facilityId }, include: { user: { select: { displayName: true } } }, orderBy: { occurredAt: "desc" }, take: 40 }),
      db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: { id: true, code: true, name: true, reorderLevel: true, inventoryBatches: { where: { active: true }, select: { id: true, batchNumber: true, quantityAvailable: true, expiryDate: true } } } }),
      db.auditChainHead.findUnique({ where: { facilityId: user.facilityId } }),
      db.governanceEvidence.findMany({ where: { facilityId: user.facilityId } }),
    ]);
    const databaseLatencyMs = Date.now() - queryStartedAt;
    const outstanding = openInvoices.reduce((sum, invoice) => sum + invoice.items.reduce((value, item) => value + Number(item.quantity) * Number(item.unitPrice), 0) - invoice.payments.reduce((value, payment) => value + Number(payment.amount), 0), 0);
    const inNinetyDays = new Date(Date.now() + 90 * 86400000);
    const lowStock = stock.filter(item => item.reorderLevel != null && item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0) <= Number(item.reorderLevel));
    const expiringStock = stock.filter(item => item.inventoryBatches.some(batch => batch.expiryDate <= inNinetyDays && Number(batch.quantityAvailable) > 0));
    const stockActions = [
      ...lowStock.map(item => ({ issue: "LOW_STOCK", catalogItemId: item.id, batchId: null, code: item.code, name: item.name, detail: `Available ${item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0)} · reorder level ${Number(item.reorderLevel)}` })),
      ...stock.flatMap(item => item.inventoryBatches.filter(batch => batch.expiryDate <= inNinetyDays && Number(batch.quantityAvailable) > 0).map(batch => ({ issue: "EXPIRING", catalogItemId: item.id, batchId: batch.id, code: item.code, name: item.name, detail: `Batch ${batch.batchNumber} · expiry ${batch.expiryDate.toISOString().slice(0, 10)} · available ${Number(batch.quantityAvailable)}` }))),
    ];
    const configuration = productionConfigurationReadiness();
    const governance = governanceReadiness(governanceEvidence);
    return await auditedOperationalJson(user, "admin/overview", { metrics: { registeredToday, waiting, visitsToday, activeStaff, outstanding, pendingClaims, pendingOrders, lowStock: lowStock.length, expiringStock: expiringStock.length, activeSessions: sessions.length }, actionItems: { stock: stockActions }, sessions: sessions.map(({ tokenHash: _tokenHash, ...session }) => session), audits: audits.map((event) => ({ ...event, sequence: event.sequence == null ? null : String(event.sequence) })), operations: {
      environment: process.env.VERCEL_ENV || "local", release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.npm_package_version || "local",
      databaseLatencyMs, audit: { sequence: auditHead ? String(auditHead.sequence) : "0", updatedAt: auditHead?.updatedAt || null },
      configuration, governance: { approved: governance.approved, total: governance.total, ready: governance.ready },
    } });
  } catch (error) { return apiError(error); }
}
