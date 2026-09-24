import { recordReportAccess } from "@/lib/report-access";
import { privateResponse } from "@/lib/outpatient-access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { patientAgeYears } from "@/lib/domain";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a valid reporting month");
const ageBand = (age: number | null) => age == null ? "UNKNOWN" : age < 5 ? "UNDER_5" : age < 15 ? "5_14" : age < 25 ? "15_24" : age < 50 ? "25_49" : "50_PLUS";

export async function GET(request: Request) {
  try {
    const user = await requirePermission("reports.clinical.read");
    const month = monthSchema.parse(new URL(request.url).searchParams.get("month"));
    const [year, value] = month.split("-").map(Number);
    const from = new Date(Date.UTC(year, value - 1, 1) - 3 * 60 * 60 * 1000);
    const through = new Date(Date.UTC(year, value, 1) - 3 * 60 * 60 * 1000);
    const [visits, referrals] = await Promise.all([
      db.visit.findMany({ where: { facilityId: user.facilityId, arrivedAt: { gte: from, lt: through }, status: { not: "CANCELLED" } }, select: { arrivedAt: true, patient: { select: { dateOfBirth: true, estimatedAgeYears: true, sexAtBirth: true } }, encounters: { select: { status: true, diagnoses: { select: { code: true, description: true } } } }, orders: { select: { type: true, status: true, prescription: { select: { dispenseStatus: true } } } } } }),
      db.referral.count({ where: { facilityId: user.facilityId, sentAt: { gte: from, lt: through } } }),
    ]);
    const attendance: Record<string, number> = {};
    const diagnoses = new Map<string, { code: string; description: string; male: number; female: number; other: number; total: number }>();
    let signedEncounters = 0, codedVisits = 0, laboratoryOrders = 0, imagingOrders = 0, medicinesDispensed = 0;
    for (const visit of visits) {
      const sex = visit.patient.sexAtBirth === "MALE" ? "MALE" : visit.patient.sexAtBirth === "FEMALE" ? "FEMALE" : "OTHER";
      const band = ageBand(patientAgeYears(visit.patient, visit.arrivedAt)); attendance[`${sex}_${band}`] = (attendance[`${sex}_${band}`] || 0) + 1;
      const signed = visit.encounters.find(item => item.status === "SIGNED"); if (signed) signedEncounters++;
      const coded = signed?.diagnoses.filter(item => item.code) || []; if (coded.length) codedVisits++;
      for (const item of coded) { const key = item.code!; const row = diagnoses.get(key) || { code: key, description: item.description, male: 0, female: 0, other: 0, total: 0 }; if (sex === "MALE") row.male++; else if (sex === "FEMALE") row.female++; else row.other++; row.total++; diagnoses.set(key, row); }
      laboratoryOrders += visit.orders.filter(item => item.type === "LABORATORY" && item.status !== "CANCELLED").length;
      imagingOrders += visit.orders.filter(item => item.type === "IMAGING" && item.status !== "CANCELLED").length;
      medicinesDispensed += visit.orders.filter(item => item.type === "MEDICATION" && item.prescription && !["PENDING", "NOT_DISPENSED"].includes(item.prescription.dispenseStatus)).length;
    }
    const report = { reportType: "MOH/KHIS monthly source summary", submissionStatus: "REVIEW_REQUIRED", month, facility: user.facility, generatedAt: new Date().toISOString(), attendance, diagnoses: [...diagnoses.values()].sort((a,b) => b.total - a.total), services: { visits: visits.length, laboratoryOrders, imagingOrders, medicinesDispensed, referrals }, completeness: { signedEncounters, unsignedVisits: visits.length - signedEncounters, visitsWithCodedDiagnosis: codedVisits, visitsWithoutCodedDiagnosis: visits.length - codedVisits } };
    await recordReportAccess(user, "MONTHLY_CLINICAL", report);
    return privateResponse(NextResponse.json(report));
  } catch (error) { return privateResponse(apiError(error)); }
}
