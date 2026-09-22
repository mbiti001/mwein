import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { appendAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { exchangeRetryAt, exchangeTransportConfiguration, stablePayloadHash } from "@/lib/certification-workflows";
import { db } from "@/lib/db";
import { governanceReadiness } from "@/lib/governance";
import { apiError } from "@/lib/http";
import { kenyaFhirConfiguration, toKenyaCorePatient } from "@/lib/kenya-fhir";

const prepareSchema = z.object({ action: z.literal("PREPARE"), channel: z.enum(["DHA_FHIR", "PUBLIC_HEALTH"]), kind: z.string().trim().min(2).max(80), patientId: z.uuid().optional(), profileVersion: z.string().trim().min(1).max(120), payload: z.record(z.string(), z.unknown()).optional(), idempotencyKey: z.uuid().default(() => randomUUID()) });
const sendSchema = z.object({ action: z.literal("SEND"), id: z.uuid() });

export async function GET() {
  try {
    const user = await requirePermission("admin.operations");
    const submissions = await db.exchangeSubmission.findMany({ where: { facilityId: user.facilityId }, select: { id: true, channel: true, kind: true, status: true, profileVersion: true, payloadHash: true, attemptCount: true, nextAttemptAt: true, acknowledgementCode: true, errorCode: true, errorMessage: true, createdAt: true, updatedAt: true, patient: { select: { patientNumber: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    // Never return transport credentials to the browser.
    const transportStatus = (channel: "DHA_FHIR" | "PUBLIC_HEALTH") => ({ ready: exchangeTransportConfiguration(channel).ready });
    return NextResponse.json({ submissions, transports: { DHA_FHIR: transportStatus("DHA_FHIR"), PUBLIC_HEALTH: transportStatus("PUBLIC_HEALTH") } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.operations");
    const input = z.discriminatedUnion("action", [prepareSchema, sendSchema]).parse(await request.json());
    if (input.action === "PREPARE") {
      let payload: Record<string, unknown>;
      if (input.channel === "DHA_FHIR") {
        if (!input.patientId) throw Object.assign(new Error("Select a reconciled patient for a FHIR submission"), { status: 422 });
        const configuration = kenyaFhirConfiguration();
        if (!configuration) throw Object.assign(new Error("Approved Kenya Core canonical configuration is not complete"), { status: 503 });
        const patient = await db.patient.findFirst({ where: { id: input.patientId, facilityId: user.facilityId, active: true }, include: { facility: { select: { code: true } }, addresses: { where: { primary: true }, take: 1 } } });
        if (!patient) throw Object.assign(new Error("Patient not found"), { status: 404 });
        payload = toKenyaCorePatient(patient, configuration);
      } else {
        if (!input.payload) throw Object.assign(new Error("Provide the approved public-health dataset payload"), { status: 422 });
        payload = input.payload;
      }
      const item = await db.$transaction(async (tx) => {
        const submission = await tx.exchangeSubmission.create({ data: { facilityId: user.facilityId, patientId: input.patientId, channel: input.channel, kind: input.kind, idempotencyKey: input.idempotencyKey, profileVersion: input.profileVersion, payload: payload as Prisma.InputJsonValue, payloadHash: stablePayloadHash(payload), createdById: user.id } });
        await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "EXCHANGE_SUBMISSION_PREPARED", entityType: "ExchangeSubmission", entityId: submission.id, afterHash: `${submission.channel}:${submission.payloadHash}:${submission.profileVersion}` });
        return submission;
      });
      return NextResponse.json({ submission: item }, { status: 201 });
    }
    const submission = await db.exchangeSubmission.findFirst({ where: { id: input.id, facilityId: user.facilityId } });
    if (!submission) throw Object.assign(new Error("Submission not found"), { status: 404 });
    if (!["PREPARED", "FAILED", "REJECTED"].includes(submission.status)) throw Object.assign(new Error(`Submission is already ${submission.status}`), { status: 409 });
    const transport = exchangeTransportConfiguration(submission.channel as "DHA_FHIR" | "PUBLIC_HEALTH");
    if (!transport.ready) throw Object.assign(new Error("Transport remains disabled until the approved HTTPS endpoint and credential are configured"), { status: 503 });
    const gates = governanceReadiness(await db.governanceEvidence.findMany({ where: { facilityId: user.facilityId } }));
    const requiredGate = submission.channel === "DHA_FHIR" ? "DHA_INTEGRATIONS" : "PUBLIC_HEALTH_REPORTING";
    if (!gates.gates.find((gate) => gate.code === requiredGate)?.ready) throw Object.assign(new Error(`${requiredGate} governance evidence is not approved`), { status: 503 });
    const attemptedAt = new Date();
    let response: Response;
    try {
      response = await fetch(transport.endpoint, { method: "POST", headers: { Authorization: `Bearer ${transport.token}`, "Content-Type": "application/json", "Idempotency-Key": submission.idempotencyKey }, body: JSON.stringify(submission.payload), signal: AbortSignal.timeout(20_000) });
    } catch (cause) {
      const attemptCount = submission.attemptCount + 1;
      const failed = await db.exchangeSubmission.update({ where: { id: submission.id }, data: { status: "FAILED", attemptCount, lastAttemptAt: attemptedAt, nextAttemptAt: exchangeRetryAt(attemptCount, attemptedAt), errorCode: "TRANSPORT_ERROR", errorMessage: cause instanceof Error ? cause.message.slice(0, 500) : "Transport failed" } });
      return NextResponse.json({ submission: failed }, { status: 502 });
    }
    const raw = await response.text();
    let acknowledgement: unknown = { raw: raw.slice(0, 5000) };
    try { acknowledgement = raw ? JSON.parse(raw) : {}; } catch { /* retained as bounded raw acknowledgement */ }
    const accepted = response.ok;
    const updated = await db.$transaction(async (tx) => {
      const item = await tx.exchangeSubmission.update({ where: { id: submission.id }, data: { status: accepted ? "ACKNOWLEDGED" : "REJECTED", attemptCount: { increment: 1 }, lastAttemptAt: attemptedAt, nextAttemptAt: accepted ? null : exchangeRetryAt(submission.attemptCount + 1, attemptedAt), acknowledgementCode: String(response.status), acknowledgement: acknowledgement as object, errorCode: accepted ? null : `HTTP_${response.status}`, errorMessage: accepted ? null : `Endpoint rejected the submission with HTTP ${response.status}` } });
      await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: accepted ? "EXCHANGE_SUBMISSION_ACKNOWLEDGED" : "EXCHANGE_SUBMISSION_REJECTED", entityType: "ExchangeSubmission", entityId: item.id, beforeHash: submission.status, afterHash: `${item.status}:${response.status}:${item.attemptCount}` });
      return item;
    });
    return NextResponse.json({ submission: updated }, { status: accepted ? 200 : 502 });
  } catch (error) { return apiError(error); }
}
