import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { integrationReadiness } from "@/lib/integrations";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requirePermission("admin.dashboard");
    return NextResponse.json({ integrations: integrationReadiness() });
  } catch (error) {
    return apiError(error);
  }
}
