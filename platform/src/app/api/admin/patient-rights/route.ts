import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

// Consolidated into the identity-verified, audited privacy workflow.
export async function GET() {
  try {
    await requirePermission("privacy.manage");
    return NextResponse.json({ error: "Use Privacy & rights for patient requests.", replacement: "/api/patients/[id]/privacy" }, { status: 410 });
  } catch (error) { return apiError(error); }
}
export const POST = GET;
