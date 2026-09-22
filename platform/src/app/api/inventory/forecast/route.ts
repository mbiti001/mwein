import { auditedOperationalJson } from "@/lib/audited-json";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { stockForecast } from "@/lib/stock-forecast";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("inventory.view");
    const lookbackDays = z.coerce.number().int().min(30).max(365).default(90).parse(new URL(request.url).searchParams.get("days") || undefined);
    const since = new Date(Date.now() - lookbackDays * 86400000);
    const inThirtyDays = new Date(Date.now() + 30 * 86400000);
    const items = await db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: {
      id: true, code: true, name: true, reorderLevel: true,
      inventoryBatches: { where: { active: true }, select: { quantityAvailable: true, expiryDate: true } },
      dispensations: { where: { status: "DISPENSED", dispensedAt: { gte: since } }, select: { quantity: true } },
    } });
    const forecasts = items.map(item => stockForecast({ code: item.code, name: item.name, reorderLevel: Number(item.reorderLevel || 0), available: item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0), consumed: item.dispensations.reduce((sum, dispensation) => sum + Number(dispensation.quantity), 0), expiringWithin30: item.inventoryBatches.filter(batch => batch.expiryDate <= inThirtyDays).reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0) }, lookbackDays));
    const rank: Record<string, number> = { STOCK_OUT: 0, CRITICAL: 1, LOW: 2, SLOW_MOVING: 3, HEALTHY: 4 };
    return await auditedOperationalJson(user, "inventory/forecast", { generatedAt: new Date().toISOString(), lookbackDays, forecasts: forecasts.sort((left, right) => rank[left.status] - rank[right.status] || right.suggestedOrder - left.suggestedOrder) });
  } catch (error) { return apiError(error); }
}
