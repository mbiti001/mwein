import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { visitCancellationReasonLabel } from "@/lib/visit-cancellation";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("clinical.history.read");
    const { id } = await params;
    const currentVisitId = new URL(request.url).searchParams.get("exclude");
    const patient = await db.patient.findFirst({ where: { id, facilityId: user.facilityId }, select: { id: true, patientNumber: true, fullName: true, allergies: { where: { active: true }, select: { substance: true, reaction: true, severity: true } } } });
    if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
    const [visits, problems, appointments, referrals] = await Promise.all([db.visit.findMany({
      where: { patientId: id, ...(currentVisitId ? { id: { not: currentVisitId } } : {}) },
      orderBy: { arrivedAt: "desc" },
      take: 20,
      select: {
        id: true, visitNumber: true, clinic: true, arrivedAt: true, status: true,
        triage: { select: { observations: { select: { code: true, valueDecimal: true, unit: true, recordedAt: true } } } },
        cancellation: { select: { reasonCode: true, details: true, shaOutcome: true, cancelledAt: true, cancelledBy: { select: { displayName: true } } } },
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
    }), db.appointment.findMany({ where: { patientId: id, facilityId: user.facilityId }, select: { id: true, scheduledAt: true, clinic: true, status: true }, orderBy: { scheduledAt: "desc" }, take: 20 }), db.referral.findMany({ where: { patientId: id, facilityId: user.facilityId }, select: { id: true, referralNumber: true, receivingFacility: true, reason: true, status: true, createdAt: true, returnedAt: true, closedAt: true }, orderBy: { createdAt: "desc" }, take: 20 })]);
    const timeline = [
      ...visits.map(visit => ({
        id: `visit-${visit.id}`,
        type: "VISIT",
        occurredAt: visit.cancellation?.cancelledAt || visit.arrivedAt,
        title: `${visit.clinic} · ${visit.visitNumber}`,
        detail: visit.cancellation
          ? `CANCELLED · ${visitCancellationReasonLabel(visit.cancellation.reasonCode)}${visit.cancellation.shaOutcome ? ` · ${visit.cancellation.shaOutcome.replaceAll("_", " ")}` : ""} · ${visit.cancellation.details} · recorded by ${visit.cancellation.cancelledBy.displayName}`
          : `${visit.status.replaceAll("_", " ")} · ${visit.encounters[0]?.diagnoses.map(item => `${item.code || ""} ${item.description}`.trim()).join("; ") || "No signed diagnosis"}`,
      })),
      ...appointments.map(item => ({ id: `appointment-${item.id}`, type: "APPOINTMENT", occurredAt: item.scheduledAt, title: `${item.clinic} appointment`, detail: item.status.replaceAll("_", " ") })),
      ...referrals.map(item => ({ id: `referral-${item.id}`, type: "REFERRAL", occurredAt: item.closedAt || item.returnedAt || item.createdAt, title: `Referral ${item.referralNumber} · ${item.receivingFacility}`, detail: `${item.status} · ${item.reason}` })),
      ...problems.map(item => ({ id: `problem-${item.id}`, type: "PROBLEM", occurredAt: item.updatedAt, title: `${item.clinicalStatus} problem · ${item.description}`, detail: `${item.code || "Uncoded"} · recorded by ${item.recordedBy.displayName}` })),
    ].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
    await recordClinicalAccess(user, "PATIENT_HISTORY", [{ type: "Patient", id: patient.id }]);
    return NextResponse.json({ patient, visits, problems, appointments, referrals, timeline }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
