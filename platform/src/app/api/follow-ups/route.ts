import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordDisclosure } from "@/lib/disclosure-audit";
import { apiError, privateJson } from "@/lib/http";
import { clinicalFollowUpDate } from "@/lib/follow-ups";
import { kenyaDayStart } from "@/lib/appointments";

const patientSelection = { select: { id: true, patientNumber: true, fullName: true } } as const;
const visitSelection = { select: { id: true, visitNumber: true, clinic: true, patient: patientSelection } } as const;

export async function GET() {
  try {
    const user = await requirePermission("visit.read");
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 86400000);
    const referralStale = new Date(now.getTime() - 7 * 86400000);
    const [appointmentRows, referralRows, specialtyRows, encounters] = await Promise.all([
      db.appointment.findMany({
        where: { facilityId: user.facilityId, scheduledAt: { gte: new Date(kenyaDayStart(now).getTime() - 90 * 86400000), lt: now }, status: { in: ["NO_SHOW", "SCHEDULED"] } },
        select: { id: true, scheduledAt: true, clinic: true, status: true, patient: patientSelection },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 101,
      }),
      db.referral.findMany({
        where: { facilityId: user.facilityId, status: { in: ["SENT", "ACCEPTED", "ATTENDED"] }, updatedAt: { lt: referralStale } },
        select: { id: true, referralNumber: true, receivingFacility: true, status: true, updatedAt: true, patient: patientSelection },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 101,
      }),
      db.servicePointRecord.findMany({
        where: { encounter: { status: "SIGNED", visit: { facilityId: user.facilityId, status: { not: "CANCELLED" } } }, followUpAt: { lte: horizon } },
        select: { id: true, servicePoint: true, followUpAt: true, encounter: { select: { visit: visitSelection } } },
        orderBy: [{ followUpAt: "asc" }, { id: "asc" }], take: 101,
      }),
      db.encounter.findMany({
        where: { visit: { facilityId: user.facilityId, status: { not: "CANCELLED" } }, status: "SIGNED", plan: { not: null }, signedAt: { gte: new Date(now.getTime() - 365 * 86400000) } },
        select: { id: true, plan: true, signedAt: true, visit: visitSelection },
        orderBy: [{ signedAt: "desc" }, { id: "asc" }], take: 1001,
      }),
    ]);
    const clinicalRows = encounters.slice(0, 1000).flatMap(encounter => {
      const followUpAt = clinicalFollowUpDate(encounter.plan);
      if (!followUpAt || new Date(followUpAt) > horizon) return [];
      return [{ id: encounter.id, followUpAt, clinic: encounter.visit.clinic, visitId: encounter.visit.id, visitNumber: encounter.visit.visitNumber, patient: encounter.visit.patient }];
    }).sort((a, b) => a.followUpAt.localeCompare(b.followUpAt) || a.id.localeCompare(b.id));
    const appointments = appointmentRows.slice(0, 100), referrals = referralRows.slice(0, 100), specialty = specialtyRows.slice(0, 100), clinical = clinicalRows.slice(0, 100);
    const truncated = { appointments: appointmentRows.length > 100, referrals: referralRows.length > 100, specialty: specialtyRows.length > 100, clinical: clinicalRows.length > 100, clinicalScan: encounters.length > 1000 };
    await recordDisclosure(user, "FOLLOW_UPS", [...appointments, ...referrals, ...specialty, ...clinical].map(item => item.id));
    return privateJson({
      generatedAt: now.toISOString(), horizon: horizon.toISOString(), truncated,
      summary: { missedAppointments: appointments.length, referralFeedback: referrals.length, specialtyReviews: specialty.length, clinicalFollowUps: clinical.length },
      worklists: { appointments, referrals, specialty: specialty.map(item => ({ id: item.id, servicePoint: item.servicePoint, followUpAt: item.followUpAt, visitId: item.encounter.visit.id, visitNumber: item.encounter.visit.visitNumber, patient: item.encounter.visit.patient })), clinical },
    });
  } catch (error) { return apiError(error); }
}
