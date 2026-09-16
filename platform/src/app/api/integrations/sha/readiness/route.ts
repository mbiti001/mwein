import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { shaGatewayReadiness } from "@/lib/sha";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const user = await requirePermission("claims.write");
    const profile = await db.shaContractProfile.findUnique({ where: { facilityId: user.facilityId } });
    return NextResponse.json(shaGatewayReadiness(profile));
  } catch (error) { return apiError(error); }
}
