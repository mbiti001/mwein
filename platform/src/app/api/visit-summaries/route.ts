import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";

function parsed(value: string | null | undefined) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

export async function GET(request: Request) {
  try {
    const user = await requirePermission("visit.read");
    const raw = new URL(request.url).searchParams.get("q") || "";
    const query = z.string().trim().max(120).parse(raw);
    const visits = await db.visit.findMany({
      where: {
        facilityId: user.facilityId,
        ...(query ? { OR: [
          { visitNumber: { contains: query, mode: "insensitive" } },
          { patient: { fullName: { contains: query, mode: "insensitive" } } },
          { patient: { patientNumber: { contains: query, mode: "insensitive" } } },
          { patient: { contacts: { some: { value: { contains: query } } } } },
        ] } : {}),
      },
      include: {
        facility: { select: { name: true, code: true, timezone: true } },
        patient: { select: { fullName: true, patientNumber: true, dateOfBirth: true, estimatedAgeYears: true, sexAtBirth: true, allergies: { where: { active: true } } } },
        triage: { include: { observations: true } },
        encounters: { include: { diagnoses: true, clinician: { select: { displayName: true } } }, orderBy: { createdAt: "desc" } },
        orders: { include: {
          laboratory: { include: { result: { include: { items: true, verifiedBy: { select: { displayName: true } } } } } },
          imaging: { include: { result: { include: { performedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } } } } },
          prescription: { include: {
            dispensedBy: { select: { displayName: true } },
            stockMovements: { where: { type: "DISPENSE" }, include: { batch: { select: { batchNumber: true, expiryDate: true } } }, orderBy: { occurredAt: "asc" } },
          } },
        }, orderBy: { requestedAt: "asc" } },
        invoice: { include: { items: true, payments: { where: { status: "CONFIRMED" }, include: { receipt: true } } } },
      },
      orderBy: { arrivedAt: "desc" }, take: query ? 50 : 25,
    });
    const summaries = visits.map(visit => {
      const encounter = visit.encounters.find(item => item.status === "SIGNED") || visit.encounters[0] || null;
      const subjective = parsed(encounter?.subjective);
      const objective = parsed(encounter?.objective);
      const plan = parsed(encounter?.plan);
      delete plan.confidentialNote;
      return { ...visit, encounter: encounter ? { id: encounter.id, status: encounter.status, signedAt: encounter.signedAt, clinician: encounter.clinician, diagnoses: encounter.diagnoses, subjective, objective, plan } : null, encounters: undefined };
    });
    return NextResponse.json({ summaries });
  } catch (error) { return apiError(error); }
}
