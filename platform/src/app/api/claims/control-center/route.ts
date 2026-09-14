import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { claimControlSummary } from "@/lib/claim-control";

export async function GET() {
  try {
    const user = await requirePermission("claims.write");
    const records = await db.claim.findMany({
      where: { payer: "SHA", invoice: { visit: { facilityId: user.facilityId } } },
      select: {
        id: true,
        claimNumber: true,
        fundCode: true,
        amount: true,
        status: true,
        serviceDate: true,
        submissionDeadline: true,
        submittedAt: true,
        updatedAt: true,
        invoice: { select: { visit: { select: { patient: { select: { fullName: true, patientNumber: true } } } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const claims = records.map(record => ({
      id: record.id,
      claimNumber: record.claimNumber,
      patientName: record.invoice.visit.patient.fullName,
      patientNumber: record.invoice.visit.patient.patientNumber,
      fundCode: record.fundCode,
      amount: Number(record.amount),
      status: record.status,
      serviceDate: record.serviceDate,
      submissionDeadline: record.submissionDeadline,
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
    }));
    return NextResponse.json({ claims, summary: claimControlSummary(claims) });
  } catch (error) {
    return apiError(error);
  }
}
