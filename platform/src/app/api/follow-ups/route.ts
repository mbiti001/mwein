import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

function planDate(value: string | null) { try { const parsed = value ? JSON.parse(value) : {}; return typeof parsed.followUpDate === "string" ? parsed.followUpDate : null; } catch { return null; } }

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const now = new Date(); const horizon = new Date(Date.now() + 14 * 86400000); const referralStale = new Date(Date.now() - 7 * 86400000);
    const [appointments, referrals, specialty, encounters] = await Promise.all([
      db.appointment.findMany({ where: { facilityId: user.facilityId, OR: [{ status: "NO_SHOW" }, { status: "SCHEDULED", scheduledAt: { lt: now } }] }, select: { id: true, scheduledAt: true, clinic: true, status: true, patient: { select: { id: true, patientNumber: true, fullName: true } } }, orderBy: { scheduledAt: "asc" }, take: 100 }),
      db.referral.findMany({ where: { facilityId: user.facilityId, status: { in: ["SENT", "ACCEPTED", "ATTENDED"] }, updatedAt: { lt: referralStale } }, select: { id: true, referralNumber: true, receivingFacility: true, status: true, updatedAt: true, reason: true, patient: { select: { id: true, patientNumber: true, fullName: true } } }, orderBy: { updatedAt: "asc" }, take: 100 }),
      db.servicePointRecord.findMany({ where: { encounter: { visit: { facilityId: user.facilityId } }, followUpAt: { lte: horizon } }, select: { id: true, servicePoint: true, followUpAt: true, riskLevel: true, encounter: { select: { visit: { select: { id: true, visitNumber: true, patient: { select: { id: true, patientNumber: true, fullName: true } } } } } } }, orderBy: { followUpAt: "asc" }, take: 100 }),
      db.encounter.findMany({ where: { visit: { facilityId: user.facilityId }, status: "SIGNED", plan: { not: null }, signedAt: { gte: new Date(Date.now() - 365 * 86400000) } }, select: { id: true, plan: true, signedAt: true, visit: { select: { id: true, visitNumber: true, clinic: true, patient: { select: { id: true, patientNumber: true, fullName: true } } } } }, take: 1000 }),
    ]);
    const clinical = encounters.flatMap(encounter => { const followUpAt = planDate(encounter.plan); if (!followUpAt || new Date(followUpAt) > horizon) return []; return [{ id: encounter.id, followUpAt, clinic: encounter.visit.clinic, visitId: encounter.visit.id, visitNumber: encounter.visit.visitNumber, patient: encounter.visit.patient }]; }).sort((a, b) => a.followUpAt.localeCompare(b.followUpAt)).slice(0, 100);
    return NextResponse.json({ generatedAt: now.toISOString(), horizon: horizon.toISOString(), summary: { missedAppointments: appointments.length, referralFeedback: referrals.length, specialtyReviews: specialty.length, clinicalFollowUps: clinical.length }, worklists: { appointments, referrals, specialty: specialty.map(item => ({ ...item, visitId: item.encounter.visit.id, visitNumber: item.encounter.visit.visitNumber, patient: item.encounter.visit.patient, encounter: undefined })), clinical } });
  } catch (error) { return apiError(error); }
}
