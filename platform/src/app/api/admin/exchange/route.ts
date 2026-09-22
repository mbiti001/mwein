import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

// Transport requires validated acknowledgements, atomic send locking and approved profiles.
// Do not expose patient payloads or enable draft transport through environment flags.
export async function GET() {
  try {
    await requirePermission("admin.operations");
    return NextResponse.json({ error: "National exchange is not enabled in this release." }, { status: 503 });
  } catch (error) { return apiError(error); }
}
export const POST = GET;
