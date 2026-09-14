import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const resultKind = z.enum(["laboratory", "imaging"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const user = await requirePermission("clinical.results.read");
    const params = await context.params;
    const kind = resultKind.parse(params.kind);
    const id = z.uuid().parse(params.id);
    if (kind === "laboratory") {
      const record = await db.laboratoryResult.findFirst({
        where: {
          id,
          status: "VERIFIED",
          verifiedAt: { not: null },
          laboratoryOrder: { order: { visit: { facilityId: user.facilityId } } },
        },
        include: {
          items: true,
          recordedBy: { select: { displayName: true } },
          verifiedBy: { select: { displayName: true } },
          laboratoryOrder: {
            include: {
              order: {
                include: {
                  visit: {
                    select: {
                      visitNumber: true,
                      patient: { select: { patientNumber: true, fullName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!record) throw Object.assign(new Error("Laboratory result not found"), { status: 404 });
      return NextResponse.json(
        { kind: "LABORATORY_RESULT", record },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const record = await db.imagingResult.findFirst({
      where: {
        id,
        status: "VERIFIED",
        verifiedAt: { not: null },
        imagingOrder: { order: { visit: { facilityId: user.facilityId } } },
      },
      include: {
        performedBy: { select: { displayName: true } },
        verifiedBy: { select: { displayName: true } },
        imagingOrder: {
          include: {
            order: {
              include: {
                visit: {
                  select: {
                    visitNumber: true,
                    patient: { select: { patientNumber: true, fullName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!record) throw Object.assign(new Error("Imaging result not found"), { status: 404 });
    return NextResponse.json(
      { kind: "IMAGING_RESULT", record },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
