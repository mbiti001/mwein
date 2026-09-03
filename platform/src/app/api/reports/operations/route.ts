import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { isIsoCalendarDate, summarizeOperations } from "@/lib/reporting";

const dateText = z.string().refine(isIsoCalendarDate, "A valid date is required");
const querySchema = z
  .object({ from: dateText, to: dateText })
  .refine((value) => value.from <= value.to, {
    message: "The start date must not follow the end date",
  });

export async function GET(request: Request) {
  try {
    const user = await requirePermission("billing.read");
    const url = new URL(request.url);
    const input = querySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    const from = new Date(`${input.from}T00:00:00+03:00`);
    const through = new Date(`${input.to}T00:00:00+03:00`);
    through.setUTCDate(through.getUTCDate() + 1);
    if (through.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000)
      throw Object.assign(new Error("Reports are limited to 31 days"), { status: 422 });

    const visits = await db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        arrivedAt: { gte: from, lt: through },
      },
      select: {
        priority: true,
        status: true,
        invoice: {
          select: {
            items: { select: { quantity: true, unitPrice: true } },
            payments: { select: { amount: true, status: true } },
            claims: {
              select: {
                id: true,
                claimNumber: true,
                payer: true,
                amount: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    return NextResponse.json({
      range: input,
      generatedAt: new Date().toISOString(),
      summary: summarizeOperations(visits),
    });
  } catch (error) {
    return apiError(error);
  }
}
