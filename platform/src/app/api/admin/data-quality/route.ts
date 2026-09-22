import { auditedOperationalJson } from "@/lib/audited-json";
import { requirePermission } from "@/lib/auth";
import { duplicatePatientGroups } from "@/lib/data-quality";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const user = await requirePermission("admin.dashboard");
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [patients, visits, unsignedResults] = await Promise.all([
      db.patient.findMany({ where: { facilityId: user.facilityId, active: true }, select: { id: true, patientNumber: true, fullName: true, normalizedName: true, dateOfBirth: true, estimatedAgeYears: true, contacts: { where: { primary: true }, select: { value: true } }, consents: { where: { withdrawnAt: null }, select: { type: true, granted: true } } }, take: 2000 }),
      db.visit.findMany({ where: { facilityId: user.facilityId, createdAt: { lt: stale }, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, visitNumber: true, status: true, arrivedAt: true, patient: { select: { patientNumber: true, fullName: true } }, encounters: { select: { status: true, diagnoses: { select: { code: true } } } }, invoice: { select: { status: true } } }, orderBy: { arrivedAt: "asc" }, take: 200 }),
      db.clinicalOrder.findMany({ where: { visit: { facilityId: user.facilityId }, requestedAt: { lt: stale }, status: { in: ["REQUESTED", "IN_PROGRESS"] }, type: { in: ["LABORATORY", "IMAGING"] } }, select: { id: true, type: true, displayName: true, status: true, requestedAt: true, visit: { select: { visitNumber: true, patient: { select: { patientNumber: true, fullName: true } } } } }, take: 200 }),
    ]);
    const byId = new Map(patients.map(patient => [patient.id, patient]));
    const duplicates = duplicatePatientGroups(patients).map(group => ({ key: group.key, patients: group.patientIds.flatMap(id => { const patient = byId.get(id); return patient ? [{ id: patient.id, patientNumber: patient.patientNumber, fullName: patient.fullName }] : []; }) }));
    const missingContacts = patients.filter(patient => !patient.contacts.length).map(patient => ({ id: patient.id, patientNumber: patient.patientNumber, fullName: patient.fullName }));
    const missingAge = patients.filter(patient => !patient.dateOfBirth && patient.estimatedAgeYears == null).map(patient => ({ id: patient.id, patientNumber: patient.patientNumber, fullName: patient.fullName }));
    const missingConsent = patients.filter(patient => !patient.consents.some(consent => consent.type === "ELECTRONIC_RECORD" && consent.granted)).map(patient => ({ id: patient.id, patientNumber: patient.patientNumber, fullName: patient.fullName }));
    const incompleteVisits = visits.map(visit => ({ id: visit.id, visitNumber: visit.visitNumber, patient: visit.patient, status: visit.status, arrivedAt: visit.arrivedAt, flags: [...(!visit.encounters.some(encounter => encounter.status === "SIGNED") ? ["UNSIGNED_ENCOUNTER"] : []), ...(visit.encounters.some(encounter => encounter.status === "SIGNED" && !encounter.diagnoses.some(diagnosis => diagnosis.code)) ? ["UNCODED_DIAGNOSIS"] : []), ...(visit.invoice && !["PAID", "VOID"].includes(visit.invoice.status) ? ["UNSETTLED_INVOICE"] : [])] }));
    return await auditedOperationalJson(user, "admin/data-quality", { generatedAt: new Date().toISOString(), summary: { duplicateGroups: duplicates.length, missingContacts: missingContacts.length, missingAge: missingAge.length, missingConsent: missingConsent.length, incompleteVisits: incompleteVisits.length, delayedResults: unsignedResults.length }, issues: { duplicates, missingContacts, missingAge, missingConsent, incompleteVisits, delayedResults: unsignedResults } });
  } catch (error) { return apiError(error); }
}
