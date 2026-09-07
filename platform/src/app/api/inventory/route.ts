import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const user = await requirePermission("inventory.view");
    const items = await db.catalogItem.findMany({
      where: { facilityId: user.facilityId, category: "PHARMACEUTICAL", active: true },
      include: { inventoryBatches: { where: { active: true }, include: { locationBalances: { include: { store: true } } }, orderBy: { expiryDate: "asc" } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ items });
  } catch (error) { return apiError(error); }
}

export async function POST() {
  return NextResponse.json({ error: "Direct stock receipt is disabled. Use Pharmacy & stock → Receive stock against an independently approved purchase order." }, { status: 405 });
}
