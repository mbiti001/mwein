import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("clinical.history.read");
    const { id } = await params;
    const currentVisitId = new URL(request.url).searchParams.get("exclude");
    const patient = await db.patient.findFirst({ where: { id, facilityId: user.facilityId }, select: { id: true } });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
    const [visits, problems] = await Promise.all([db.visit.findMany({
      where: { patientId: id, ...(currentVisitId ? { id: { not: currentVisitId } } : {}) },
      orderBy: { arrivedAt: "desc" },
      take: 5,
      select: {
        id: true, visitNumber: true, clinic: true, arrivedAt: true, status: true,
        encounters: { where: { status: "SIGNED" }, orderBy: { signedAt: "desc" }, take: 1, select: { signedAt: true, diagnoses: { select: { description: true, code: true, primary: true } } } },
        orders: { where: { status: { not: "CANCELLED" } }, orderBy: { requestedAt: "asc" }, select: {
          type: true, displayName: true,
          prescription: { select: { genericName: true, strength: true, dose: true, frequency: true, duration: true, dispenseStatus: true } },
          laboratory: { select: { result: { select: { status: true, items: { select: { analyte: true, value: true, unit: true, flag: true } } } } } },
          imaging: { select: { result: { select: { status: true, conclusion: true } } } },
        } },
      },
    }), db.patientProblem.findMany({
      where: { patientId: id, facilityId: user.facilityId },
      include: { recordedBy: { select: { displayName: true } } },
      orderBy: [{ clinicalStatus: "asc" }, { updatedAt: "desc" }],
    })]);
    return NextResponse.json({ visits, problems });
  } catch (error) { return apiError(error); }
}
