import { auditedOperationalJson } from "@/lib/audited-json";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { stockForecast, usableBatchStock } from "@/lib/stock-forecast";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("inventory.view");
    const lookbackDays = z.coerce.number().int().min(30).max(365).default(90).parse(new URL(request.url).searchParams.get("days") || undefined);
    const now = new Date();
    const since = new Date(now.getTime() - lookbackDays * 86400000);
    const items = await db.catalogItem.findMany({ where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true }, select: {
      id: true, code: true, name: true, reorderLevel: true,
      inventoryBatches: { where: { active: true, expiryDate: { gt: now }, quantityAvailable: { gt: 0 } }, select: { quantityAvailable: true, expiryDate: true } },
      dispensations: { where: { status: "DISPENSED", dispensedAt: { gte: since } }, select: { quantity: true } },
    } });
    const forecasts = items.map(item => {
      const stock = usableBatchStock(item.inventoryBatches, now);
      return stockForecast({ code: item.code, name: item.name, reorderLevel: Number(item.reorderLevel || 0), available: stock.available, consumed: item.dispensations.reduce((sum, dispensation) => sum + Number(dispensation.quantity), 0), expiringWithin30: stock.expiringWithin30 }, lookbackDays);
    });
    const rank: Record<string, number> = { STOCK_OUT: 0, CRITICAL: 1, LOW: 2, SLOW_MOVING: 3, HEALTHY: 4 };
    return await auditedOperationalJson(user, "inventory/forecast", { generatedAt: new Date().toISOString(), lookbackDays, forecasts: forecasts.sort((left, right) => rank[left.status] - rank[right.status] || right.suggestedOrder - left.suggestedOrder) });
  } catch (error) { return apiError(error); }
}
