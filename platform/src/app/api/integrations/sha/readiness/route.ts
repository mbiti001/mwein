import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { shaGatewayReadiness } from "@/lib/sha";

export async function GET() {
  try {
    await requirePermission("claims.write");
    return NextResponse.json(shaGatewayReadiness());
  } catch (error) { return apiError(error); }
}
