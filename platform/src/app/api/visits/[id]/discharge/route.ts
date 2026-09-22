import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { closeVisitSchema } from "@/lib/visit-disposition";
import { closeClinicalVisit } from "@/lib/close-visit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("encounter.write");
    const { id } = await context.params;
    const input = closeVisitSchema.parse(await request.json());
    const result = await db.$transaction(tx => closeClinicalVisit(tx, actor, id, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
