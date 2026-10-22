import { prescriptionCalculation, readPrescribingDefaults } from "@/lib/prescribing-defaults";
import { ensureServiceTask } from "@/lib/visit-handoff";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { workflowTransaction } from "@/lib/workflow-transaction";
import { requirePermission } from "@/lib/auth";
import { apiError, privateJson } from "@/lib/http";
import { consultationRevision, consultationConflict, nextEncounterTime } from "@/lib/consultation-revision";
import { recordClinicalAccess } from "@/lib/clinical-access";
import { createHash } from "node:crypto";
import { appendAudit, auditValueFingerprint } from "@/lib/audit";
import { canonicalLaboratoryCode } from "@/lib/laboratory";
import { verifyDiagnosisSelectionToken } from "@/lib/diagnosis-selection";
import { normalizeMedicationConcept, periodsOverlap, prescriptionSnapshot, sameVisitMedicationKey, treatmentStopDate } from "@/lib/medication";
import { evaluateMedicationSafety, medicationSafetyContextHash } from "@/lib/medication-safety";
import { effectiveCatalogPrice } from "@/lib/catalog-pricing";
import { dispositionVisitStatus, normalizedVisitOutcome } from "@/lib/visit-disposition";
import { closeClinicalVisit } from "@/lib/close-visit";
import {
  consultationNotesSchema,
  diagnosisSchema,
  investigationOrderSchema,
  prescriptionSchema,
  signConsultationSchema,
} from "@/lib/consultation";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_NOTES"), expectedRevision: z.string().max(120).nullable().optional(), data: consultationNotesSchema }),
  z.object({ action: z.literal("SAVE_DIAGNOSIS"), expectedRevision: z.string().max(120).nullable().optional(), data: diagnosisSchema }),
  z.object({
    action: z.literal("SUBMIT_INVESTIGATIONS"),
    data: investigationOrderSchema,
  }),
  z.object({
    action: z.literal("SAVE_PRESCRIPTION"),
    data: prescriptionSchema,
  }),
  z.object({ action: z.literal("SIGN"), expectedRevision: z.string().max(120).nullable().optional(), data: signConsultationSchema }),
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("encounter.write");
    const id = z.uuid().parse((await context.params).id);
    const visit = await db.visit.findFirst({
      where: { id, facilityId: user.facilityId },
      select: {
        id: true, status: true, clinicallyClosedAt: true,
        orders: { where: { type: "MEDICATION" }, include: { prescription: true, orderedBy: { select: { displayName: true } } }, orderBy: { requestedAt: "asc" } },
        encounters: {
          orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 1,
          select: { id: true, status: true, subjective: true, objective: true, assessment: true, plan: true,
            updatedAt: true, signedAt: true, diagnoses: true, clinician: { select: { displayName: true } } },
        },
      },
    });
    if (!visit) throw Object.assign(new Error("Visit not found"), { status: 404 });
    await recordClinicalAccess(user, "CONSULTATION_RECOVERY", [{ type: "Visit", id }, ...visit.encounters.map(item => ({ type: "Encounter" as const, id: item.id }))]);
    return privateJson({ visit });
  } catch (error) { return apiError(error); }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("encounter.write");
    const id = z.uuid().parse((await context.params).id);
    const input = requestSchema.parse(await request.json());
    const result = await workflowTransaction(
      async (tx) => {
        const visit = await tx.visit.findFirst({
          where: { id, facilityId: user.facilityId },
          include: {
            invoice: true,
            encounters: { orderBy: { createdAt: "desc" } },
            patient: { include: { allergies: { where: { active: true } } } },
            orders: { include: { laboratory: true, imaging: true, prescription: true, invoiceItems: true } },
            dispositionRecord: true,
          },
        });
        if (!visit)
          throw Object.assign(new Error("Visit not found"), { status: 404 });
        if (visit.clinicallyClosedAt || ["CANCELLED", "COMPLETED", "DISCHARGED"].includes(visit.status))
          throw Object.assign(new Error("This visit is closed and cannot be changed"), { status: 409 });
        if (visit.encounters.some((item) => ["SIGNED", "CORRECTED"].includes(item.status)))
          throw Object.assign(
            new Error("This consultation is already signed"),
            { status: 409 },
          );
        let encounter = visit.encounters.find(
          (item) => item.status === "DRAFT",
        );

        if ((input.action === "SAVE_NOTES" || input.action === "SIGN" || input.action === "SAVE_DIAGNOSIS") && input.expectedRevision === undefined)
          throw Object.assign(new Error("Reload the consultation before saving or signing. This screen has no saved revision."), { status: 428 });
        if ((input.action === "SIGN" || input.action === "SAVE_DIAGNOSIS") && input.expectedRevision !== consultationRevision(encounter)) throw consultationConflict();

        if (input.action === "SAVE_NOTES") {
          const data = {
            noteFormat: "STRUCTURED",
            subjective: JSON.stringify({
              chiefComplaint: input.data.chiefComplaint,
              complaints:
                input.data.complaints.length > 0
                  ? input.data.complaints
                  : [
                      {
                        complaint: input.data.chiefComplaint,
                        legacyDuration: input.data.symptomDuration,
                      },
                    ],
              historyPresentingIllness: input.data.historyPresentingIllness,
              symptomDuration: input.data.symptomDuration,
              reviewOfSystems: input.data.reviewOfSystems,
              pastMedicalHistory: input.data.pastMedicalHistory,
              currentMedicines: input.data.currentMedicines,
              familySocialHistory: input.data.familySocialHistory,
            }),
            objective: JSON.stringify({
              generalExamination: input.data.generalExamination,
              systemicExamination: input.data.systemicExamination,
            }),
            plan: JSON.stringify({
              plan: input.data.plan,
              confidentialNote: input.data.confidentialNote,
              followUpDate: input.data.followUpDate,
              disposition: input.data.disposition,
              dispositionDetails: input.data.dispositionDetails,
            }),
          };
          if (input.expectedRevision !== consultationRevision(encounter)) {
            // A lost response may be retried, but never overwrite a different saved snapshot.
            if (encounter && encounter.noteFormat === data.noteFormat && encounter.subjective === data.subjective && encounter.objective === data.objective && encounter.plan === data.plan) {
              const savedAudit = await tx.auditEvent.findFirst({
                where: { facilityId: user.facilityId, userId: user.id, entityType: "Encounter", entityId: encounter.id, action: "CONSULTATION_DRAFT_SAVED" },
                orderBy: { sequence: "desc" }, select: { reason: true },
              });
              // Tie confirmation to this actor's original base and the exact committed revision.
              // Matching text alone must not accept an intervening diagnosis or another writer.
              const expectedReceipt = JSON.stringify({ expectedRevision: input.expectedRevision, savedRevision: consultationRevision(encounter) });
              if (savedAudit?.reason !== expectedReceipt) throw consultationConflict();
              await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "CONSULTATION_DRAFT_CONFIRMED", entityType: "Encounter", entityId: encounter.id });
              return { stage: "NOTES_CONFIRMED", draftRevision: consultationRevision(encounter) };
            }
            throw consultationConflict();
          }
          const beforeHash = encounter ? createHash("sha256").update(JSON.stringify([encounter.subjective, encounter.objective, encounter.plan])).digest("hex") : undefined;
          encounter = encounter
            ? await tx.encounter.update({ where: { id: encounter.id, updatedAt: encounter.updatedAt, status: "DRAFT" }, data: { ...data, updatedAt: nextEncounterTime(encounter.updatedAt) } })
            : await tx.encounter.create({
                data: {
                  visitId: id,
                  clinicianId: user.id,
                  status: "DRAFT",
                  ...data,
                },
              });
          if (visit.status === "AWAITING_CLINICIAN") {
            await tx.visit.update({
              where: { id },
              data: { status: "UNDER_CONSULTATION" },
            });
            await tx.queueEntry.updateMany({
              where: {
                visitId: id,
                servicePoint: "CONSULTATION",
                status: { in: ["WAITING", "CALLED"] },
              },
              data: { status: "IN_PROGRESS", startedAt: new Date() },
            });
          }
          await appendAudit(tx, {
            userId: user.id,
            sessionId: user.sessionId,
            action: "CONSULTATION_DRAFT_SAVED",
            entityType: "Encounter",
            entityId: encounter.id,
            beforeHash,
            reason: JSON.stringify({ expectedRevision: input.expectedRevision, savedRevision: consultationRevision(encounter) }),
            afterHash: createHash("sha256").update(JSON.stringify([encounter.subjective, encounter.objective, encounter.plan])).digest("hex"),
          });
          return { stage: "NOTES_SAVED", draftRevision: consultationRevision(encounter) };
        }

        if (!encounter)
          throw Object.assign(
            new Error("Save the clinical notes before continuing"),
            { status: 409 },
          );
        if (input.action === "SAVE_DIAGNOSIS") {
          try {
            verifyDiagnosisSelectionToken(input.data.selectionToken, {
              facilityId: user.facilityId,
              code: input.data.code,
              title: input.data.title,
              foundationUri: input.data.foundationUri,
              linearizationUri: input.data.linearizationUri,
              codingVersion: input.data.codingVersion,
            });
          } catch (reason) {
            throw Object.assign(new Error((reason as Error).message), { status: 422 });
          }
          const duplicate = await tx.diagnosis.findFirst({ where: { encounterId: encounter.id, codingSystem: "ICD-11 MMS", code: input.data.code.toUpperCase() } });
          if (duplicate) throw Object.assign(new Error(`${duplicate.code} · ${duplicate.description} is already recorded for this encounter`), { status: 409 });
          if (input.data.primary)
            await tx.diagnosis.updateMany({
              where: { encounterId: encounter.id, primary: true },
              data: { primary: false },
            });
          const diagnosis = await tx.diagnosis.create({
            data: {
              encounterId: encounter.id,
              type: input.data.type,
              description: input.data.title,
              codingSystem: "ICD-11 MMS",
              code: input.data.code.toUpperCase(),
              foundationUri: input.data.foundationUri,
              linearizationUri: input.data.linearizationUri,
              codingVersion: input.data.codingVersion,
              primary: input.data.primary,
            },
          });
          const revisedEncounter = await tx.encounter.update({
            where: { id: encounter.id },
            data: { assessment: input.data.title, updatedAt: nextEncounterTime(encounter.updatedAt) },
          });
          await appendAudit(tx, {
            userId: user.id,
            action: "ICD11_DIAGNOSIS_RECORDED",
            entityType: "Diagnosis",
            entityId: diagnosis.id,
            afterHash: `${diagnosis.code}:${diagnosis.description}`,
          });
          return { stage: "DIAGNOSIS_SAVED", diagnosis, draftRevision: consultationRevision(revisedEncounter) };
        }

        const primary = await tx.diagnosis.findFirst({
          where: {
            encounterId: encounter.id,
            primary: true,
            codingSystem: "ICD-11 MMS",
            code: { not: null },
          },
        });
        if (!primary && input.action !== "SAVE_PRESCRIPTION")
          throw Object.assign(
            new Error(
              "Record a primary ICD-11 diagnosis before investigations or signing",
            ),
            { status: 409 },
          );

        if (input.action === "SUBMIT_INVESTIGATIONS") {
          const created: string[] = [];
          const pricingTime = new Date();
          const labCodes = input.data.labs.map(canonicalLaboratoryCode);
          const selectedCodes = [...labCodes, ...input.data.imaging.map((code) => code.toUpperCase())];
          const catalogue = await tx.catalogItem.findMany({
            where: {
              facilityId: user.facilityId,
              code: { in: selectedCodes },
              active: true,
            },
            include: { priceVersions: { where: { effectiveFrom: { lte: pricingTime } }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
          });
          for (const requestedCode of input.data.labs) {
            const code = canonicalLaboratoryCode(requestedCode);
            const item = catalogue.find(
              (value) =>
                value.code === code &&
                value.category === "LABORATORY_TEST",
            );
            if (!item)
              throw Object.assign(
                new Error(
                  `Laboratory test ${code} is not active in the catalogue`,
                ),
                { status: 400 },
              );
            if (
              visit.orders.some(
                (order) =>
                  order.type === "LABORATORY" &&
                  canonicalLaboratoryCode(order.laboratory?.testCode || "") === code &&
                  order.status !== "CANCELLED",
              )
            )
              continue;
            const order = await tx.clinicalOrder.create({
              data: {
                visitId: id,
                orderedById: user.id,
                type: "LABORATORY",
                priority: input.data.priority,
                displayName: item.name,
                clinicalIndication: input.data.indication,
                laboratory: {
                  create: { testCode: code, specimenType: item.specimenType! },
                },
              },
            });
            await tx.invoiceItem.create({
              data: {
                invoiceId: visit.invoice!.id,
                orderId: order.id,
                serviceCode: `LAB-${code}`,
                description: item.name,
                quantity: 1,
                unitPrice: new Prisma.Decimal(Number(effectiveCatalogPrice(item, pricingTime).unitPrice)),
                catalogItemId: item.id,
                priceVersionId: effectiveCatalogPrice(item, pricingTime).priceVersionId,
              },
            });
            created.push(item.name);
          }
          for (const code of input.data.imaging) {
            const item = catalogue.find(
              (value) =>
                value.code === code.toUpperCase() &&
                value.category === "PROCEDURE" && !value.code.startsWith("CONSULT-"),
            );
            if (!item)
              throw Object.assign(
                new Error(`Procedure ${code} is not active in the catalogue`),
                { status: 400 },
              );
            if (
              visit.orders.some(
                (order) =>
                  order.type === "IMAGING" &&
                  order.imaging?.examinationCode === code &&
                  order.status !== "CANCELLED",
              )
            )
              continue;
            const order = await tx.clinicalOrder.create({
              data: {
                visitId: id,
                orderedById: user.id,
                type: "IMAGING",
                priority: input.data.priority,
                displayName: item.name,
                clinicalIndication: input.data.indication,
                imaging: {
                  create: {
                    examinationCode: code,
                    modality: item.modality || "PROCEDURE",
                  },
                },
              },
            });
            await tx.invoiceItem.create({
              data: {
                invoiceId: visit.invoice!.id,
                orderId: order.id,
                serviceCode: `IMG-${code}`,
                description: item.name,
                quantity: 1,
                unitPrice: new Prisma.Decimal(Number(effectiveCatalogPrice(item, pricingTime).unitPrice)),
                catalogItemId: item.id,
                priceVersionId: effectiveCatalogPrice(item, pricingTime).priceVersionId,
              },
            });
            created.push(item.name);
          }
          if (!created.length)
            throw Object.assign(
              new Error("These investigations have already been submitted"),
              { status: 409 },
            );
          await tx.visit.update({
            where: { id },
            data: { status: "AWAITING_RESULTS" },
          });
          await tx.queueEntry.updateMany({
            where: {
              visitId: id,
              servicePoint: "CONSULTATION",
              status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] },
            },
            data: { status: "TRANSFERRED", completedAt: new Date() },
          });
          if (input.data.labs.length)
            await ensureServiceTask(tx, visit, "LABORATORY");
          if (input.data.imaging.length)
            await ensureServiceTask(tx, visit, "IMAGING");
          await appendAudit(tx, {
            userId: user.id,
            action: "INVESTIGATIONS_SUBMITTED",
            entityType: "Visit",
            entityId: id,
            afterHash: created.join("|"),
          });
          return { stage: "INVESTIGATIONS_SUBMITTED", created };
        }

        if (input.action === "SAVE_PRESCRIPTION") {
          const created: string[] = [];
          const warnings: string[] = [];
          const now = new Date();
          const idempotent = await tx.prescription.findUnique({
            where: { idempotencyKey: input.data.idempotencyKey },
            include: { order: true },
          });
          const requestHash = auditValueFingerprint(input.data);
          if (idempotent) {
            const receipt = idempotent.order.visitId === id && await tx.auditEvent.findFirst({ where: { facilityId: user.facilityId, userId: user.id, entityType: "Encounter", entityId: encounter.id, action: { in: ["PRESCRIPTION_SUBMITTED", "PRESCRIPTION_DRAFT_SAVED"] }, afterHash: requestHash } });
            if (!receipt) throw Object.assign(new Error("This save key belongs to a different prescription request. Reload and review the saved list."), { status: 409 });
            await appendAudit(tx, { userId: user.id, sessionId: user.sessionId, action: "PRESCRIPTION_SAVE_CONFIRMED", entityType: "Encounter", entityId: encounter.id, afterHash: requestHash });
            const orders = await tx.clinicalOrder.findMany({ where: { visitId: id, type: "MEDICATION" }, include: { prescription: true, orderedBy: { select: { displayName: true } } }, orderBy: { requestedAt: "asc" } });
            return { stage: "PRESCRIPTION_ALREADY_SAVED", created: [idempotent.order.displayName], orders, warnings: ["The original prescription was already saved. Review the saved list and medication safety findings before proceeding."] };
          }
          const catalogue = await tx.catalogItem.findMany({
            where: {
              facilityId: user.facilityId,
              code: {
                in: input.data.prescriptions.map((value) =>
                  value.medicineCode.toUpperCase(),
                ),
              },
              category: "PHARMACEUTICAL",
              active: true,
            },
            include: { priceVersions: { where: { effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
          });
          const [safetyRules, activePatientPrescriptions] = await Promise.all([
            tx.medicationSafetyRule.findMany({ where: { facilityId: user.facilityId, status: "APPROVED", OR: [{ activeFrom: null }, { activeFrom: { lte: now } }], AND: [{ OR: [{ activeTo: null }, { activeTo: { gt: now } }] }] } }),
            tx.prescription.findMany({ where: { medicationConceptId: { not: null }, order: { visit: { patientId: visit.patientId, facilityId: user.facilityId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } } }, select: { medicationConceptId: true } }),
          ]);
          const activeMedicationConcepts = activePatientPrescriptions.flatMap(item => item.medicationConceptId ? [item.medicationConceptId] : []);
          for (const [lineIndex, medicine] of input.data.prescriptions.entries()) {
            const lineSaveKey = lineIndex === 0 ? input.data.idempotencyKey : `${input.data.idempotencyKey}:${lineIndex}`;
            const item = catalogue.find(
              (value) => value.code === medicine.medicineCode.toUpperCase(),
            );
            if (!item)
              throw Object.assign(
                new Error(
                  `Medicine ${medicine.medicineCode} is not active in the catalogue`,
                ),
                { status: 400 },
              );
            if (!item.genericName || !item.strength || !item.dosageForm)
              throw Object.assign(new Error(`${item.name} is missing generic name, strength or dosage form in the medicine catalogue`), { status: 422 });
            if (medicine.calculationDefaults) {
              const configured = readPrescribingDefaults(item.prescribingDefaults);
              if (!configured || JSON.stringify(configured) !== JSON.stringify(medicine.calculationDefaults))
                throw Object.assign(new Error("Medicine defaults changed. Reload the catalogue and review this line."), { status: 409 });
              const calculated = prescriptionCalculation(medicine.dose, String(medicine.frequencyPerDay ?? ""), String(medicine.durationDays ?? ""), configured);
              if (!calculated || calculated.doseQuantity !== medicine.doseQuantity || calculated.quantity !== medicine.quantity)
                throw Object.assign(new Error("The dose and calculated supply quantity do not agree."), { status: 422 });
            }
            const medicationConceptId = item.medicationConceptId || normalizeMedicationConcept(item.genericName);
            const safetyContext = {
              medicationConceptId,
              patientAllergyConcepts: visit.patient.allergies.map(record => normalizeMedicationConcept(record.substance)),
              // Check the complete proposed list, regardless of the order lines were entered.
              activeMedicationConcepts: [...new Set([...activeMedicationConcepts, ...catalogue.map(candidate => candidate.medicationConceptId || normalizeMedicationConcept(candidate.genericName || "")).filter(concept => concept && concept !== medicationConceptId)])],
              dailyDoseQuantity: medicine.doseQuantity && medicine.frequencyPerDay ? medicine.doseQuantity * medicine.frequencyPerDay : undefined,
            };
            const safetyResults = evaluateMedicationSafety(safetyRules, safetyContext);
            const hardStops = safetyResults.filter(result => result.outcome === "BLOCK");
            if (hardStops.length) throw Object.assign(new Error(hardStops.map(result => result.message).join(" ")), { status: 422, details: { code: "MEDICATION_HARD_STOP", warnings: hardStops.map(result => ({ code: result.warningCode, message: result.message })) } });
            warnings.push(...safetyResults.filter(result => result.outcome === "WARN").map(result => result.message));
            const contextHash = medicationSafetyContextHash(safetyContext);
            const startDate = medicine.startDate;
            const stopDate = treatmentStopDate(startDate, medicine.duration, medicine.stopDate);
            const activeCandidates = await tx.prescription.findMany({
              where: {
                medicationConceptId,
                order: { visit: { patientId: visit.patientId, facilityId: user.facilityId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } },
              },
              include: { order: { include: { invoiceItems: true } }, catalogItem: true },
            });
            const sameVisit = activeCandidates.find(candidate => candidate.order.visitId === id);
            const exact = activeCandidates.find(candidate =>
              candidate.strength === item.strength && candidate.dosageForm === item.dosageForm &&
              candidate.route.toLowerCase() === medicine.route.toLowerCase() &&
              candidate.frequency.toLowerCase() === medicine.frequency.toLowerCase() &&
              periodsOverlap(candidate.startDate, candidate.stopDate, startDate, stopDate) &&
              !(medicine.doseTiming !== "SCHEDULED" && candidate.doseTiming !== "SCHEDULED"),
            );
            const revised = prescriptionSnapshot({
              medicationConceptId, genericName: item.genericName, strength: item.strength, dosageForm: item.dosageForm,
              dose: medicine.dose, route: medicine.route, frequency: medicine.frequency, duration: medicine.duration,
              startDate, stopDate, quantity: medicine.quantity, instructions: medicine.instructions,
            });
            const editing = medicine.existingOrderId ? activeCandidates.find(candidate => candidate.order.id === medicine.existingOrderId && candidate.order.visitId === id) : undefined;
            if (medicine.existingOrderId && (!editing || editing.idempotencyKey !== medicine.expectedPrescriptionKey)) throw Object.assign(new Error("This prescription changed. Reload its saved details before editing."), { status: 409 });
            if (editing && editing.medicineCode.toUpperCase() !== medicine.medicineCode.toUpperCase()) throw Object.assign(new Error("Use the saved medicine when revising a prescription; a different product needs a separate clinical review."), { status: 409 });
            if (editing && (Number(editing.dispensedQuantity || 0) > 0 || editing.dispenseStatus !== "PENDING" || editing.order.status === "IN_PROGRESS")) throw Object.assign(new Error("A prescription already being supplied cannot be overwritten. Review it with pharmacy."), { status: 409 });
            if (editing && editing.order.status !== "DRAFT" && !input.data.submit) throw Object.assign(new Error("A sent prescription cannot be returned to draft."), { status: 409 });
            const draftEdit = editing?.order.status === "DRAFT";
            const duplicateAction = editing ? "EDIT_EXISTING" : input.data.duplicateAction;
            const duplicateReason = medicine.correctionReason || input.data.duplicateReason;
            if (sameVisit && !duplicateAction)
              throw Object.assign(new Error(`${sameVisit.order.displayName} is already prescribed in this visit. Edit the existing prescription instead.`), {
                status: 409,
                details: { code: "SAME_VISIT_DUPLICATE", existingOrderId: sameVisit.order.id, existingPrescriptionId: sameVisit.id, existing: prescriptionSnapshot({ ...sameVisit, quantity: Number(sameVisit.quantity) }), options: ["EDIT_EXISTING", "CANCEL"] },
              });
            if (sameVisit && duplicateAction && duplicateAction !== "EDIT_EXISTING")
              throw Object.assign(new Error("The same medicine cannot be prescribed twice in one visit. Edit the existing prescription instead."), { status: 409 });
            const duplicate = sameVisit || exact;
            if (duplicate && !sameVisit && !duplicateAction)
              throw Object.assign(new Error(`Active duplicate found: ${duplicate.order.displayName}`), {
                status: 409,
                details: { code: "EXACT_DUPLICATE", existingOrderId: duplicate.order.id, existingPrescriptionId: duplicate.id, existing: prescriptionSnapshot({ ...duplicate, quantity: Number(duplicate.quantity) }), options: ["EDIT_EXISTING", "REPLACE_EXISTING", "KEEP_BOTH", "CANCEL"] },
              });
            if (duplicate && duplicateAction && !draftEdit && !duplicateReason)
              throw Object.assign(new Error("Record a clinical reason for the duplicate decision"), { status: 422 });

            if (duplicate && ["EDIT_EXISTING", "REPLACE_EXISTING"].includes(duplicateAction || "")) {
              if (duplicate.order.visitId !== id || Number(duplicate.dispensedQuantity || 0) > 0 || duplicate.dispenseStatus !== "PENDING") throw Object.assign(new Error("Review this existing prescription in its original visit; supplied medicines cannot be overwritten."), { status: 409 });
              const original = prescriptionSnapshot({ ...duplicate, quantity: Number(duplicate.quantity) });
              const updated = await tx.prescription.update({ where: { id: duplicate.id }, data: {
                catalogItemId: item.id, medicationConceptId, genericName: item.genericName, strength: item.strength, dosageForm: item.dosageForm,
                dose: medicine.dose, route: medicine.route, frequency: medicine.frequency, duration: medicine.duration,
                doseQuantity: medicine.doseQuantity ? new Prisma.Decimal(medicine.doseQuantity) : undefined, frequencyPerDay: medicine.frequencyPerDay, durationDays: medicine.durationDays, quantityConfirmed: medicine.quantityConfirmed,
                startDate, stopDate, quantity: new Prisma.Decimal(medicine.quantity), instructions: medicine.instructions,
                isPrn: false, prnIndication: null, doseTiming: medicine.doseTiming, sequenceNote: medicine.sequenceNote,
                encounterId: encounter.id, diagnosisId: primary?.id ?? null, idempotencyKey: lineSaveKey,
                ...(sameVisit ? { visitMedicationKey: sameVisitMedicationKey(id, medicationConceptId) } : {}),
              } });
              await tx.clinicalOrder.update({ where: { id: duplicate.order.id }, data: { orderedById: user.id, displayName: item.name, clinicalIndication: medicine.indication, status: input.data.submit ? "REQUESTED" : "DRAFT" } });
              if (duplicate.order.invoiceItems.length) {
                const alreadyDispensed = Number(duplicate.dispensedQuantity || 0);
                // Dispensed lines are financial history and must retain the medicine and tariff
                // recorded at the time of supply. Only remove an unfulfilled placeholder.
                if (alreadyDispensed === 0)
                  await tx.invoiceItem.deleteMany({ where: { orderId: duplicate.order.id } });
              }
              await tx.medicationSafetyOverride.create({ data: { prescriptionId: updated.id, existingPrescriptionId: duplicate.id, prescriberId: user.id, warningCode: draftEdit ? "DRAFT_REVISED" : sameVisit ? "SAME_VISIT_EDIT" : duplicateAction!, justification: draftEdit ? "Draft reviewed before pharmacy submission" : duplicateReason!, originalDetails: original, revisedDetails: revised } });
              if (safetyResults.length) await tx.medicationSafetyAssessment.createMany({ data: safetyResults.map(result => ({ prescriptionId: updated.id, ruleId: result.ruleId, warningCode: result.warningCode, severity: result.severity, outcome: result.outcome, message: result.message, ruleVersion: result.ruleVersion, contextHash })) });
              created.push(item.name);
              if (!activeMedicationConcepts.includes(medicationConceptId)) activeMedicationConcepts.push(medicationConceptId);
              continue;
            }
            const order = await tx.clinicalOrder.create({
              data: {
                visitId: id,
                orderedById: user.id,
                type: "MEDICATION",
                status: input.data.submit ? "REQUESTED" : "DRAFT",
                displayName: item.name,
                clinicalIndication: medicine.indication,
                prescription: {
                  create: {
                    medicineCode: medicine.medicineCode,
                    catalogItemId: item.id,
                    medicationConceptId,
                    genericName: item.genericName,
                    strength: item.strength,
                    dosageForm: item.dosageForm,
                    dose: medicine.dose,
                    doseQuantity: medicine.doseQuantity ? new Prisma.Decimal(medicine.doseQuantity) : undefined,
                    route: medicine.route,
                    frequency: medicine.frequency,
                    frequencyPerDay: medicine.frequencyPerDay,
                    duration: medicine.duration,
                    durationDays: medicine.durationDays,
                    startDate,
                    stopDate,
                    isPrn: false,
                    prnIndication: null,
                    doseTiming: medicine.doseTiming,
                    sequenceNote: medicine.sequenceNote,
                    quantity: new Prisma.Decimal(medicine.quantity),
                    quantityConfirmed: medicine.quantityConfirmed,
                    instructions: medicine.instructions,
                    encounterId: encounter.id,
                    diagnosisId: primary?.id ?? null,
                    idempotencyKey: lineSaveKey,
                    visitMedicationKey: sameVisitMedicationKey(id, medicationConceptId),
                  },
                },
              },
              include: { prescription: true },
            });
            created.push(item.name);
            if (safetyResults.length) await tx.medicationSafetyAssessment.createMany({ data: safetyResults.map(result => ({ prescriptionId: order.prescription!.id, ruleId: result.ruleId, warningCode: result.warningCode, severity: result.severity, outcome: result.outcome, message: result.message, ruleVersion: result.ruleVersion, contextHash })) });
            if (!activeMedicationConcepts.includes(medicationConceptId)) activeMedicationConcepts.push(medicationConceptId);
            if (exact && duplicateAction === "KEEP_BOTH")
              await tx.medicationSafetyOverride.create({ data: { prescriptionId: order.prescription!.id, existingPrescriptionId: exact.id, prescriberId: user.id, warningCode: "EXACT_DUPLICATE_OVERRIDDEN", justification: duplicateReason!, originalDetails: prescriptionSnapshot({ ...exact, quantity: Number(exact.quantity) }), revisedDetails: revised } });
            const sameClass = item.therapeuticClass ? await tx.prescription.findFirst({ where: { id: { not: order.prescription!.id }, catalogItem: { therapeuticClass: item.therapeuticClass }, order: { visit: { patientId: visit.patientId, facilityId: user.facilityId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } } }, include: { order: true } }) : null;
            if (sameClass) warnings.push(`Therapeutic duplication: ${item.name} and ${sameClass.order.displayName} are both ${item.therapeuticClass}.`);
            const allergy = visit.patient.allergies.find(record => normalizeMedicationConcept(record.substance).includes(medicationConceptId) || medicationConceptId.includes(normalizeMedicationConcept(record.substance)));
            if (allergy) warnings.push(`Allergy warning: ${item.genericName} may match recorded allergy ${allergy.substance}.`);
          }
          await appendAudit(tx, {
            userId: user.id,
            sessionId: user.sessionId,
            facilityId: user.facilityId,
            action: input.data.submit
              ? "PRESCRIPTION_SUBMITTED"
              : "PRESCRIPTION_DRAFT_SAVED",
            entityType: "Encounter",
            entityId: encounter.id,
            afterHash: requestHash,
          });
          const orders = await tx.clinicalOrder.findMany({ where: { visitId: id, type: "MEDICATION" }, include: { prescription: true, orderedBy: { select: { displayName: true } } }, orderBy: { requestedAt: "asc" } });
          return {
            orders,
            stage: input.data.submit
              ? "PRESCRIPTION_SUBMITTED"
              : "PRESCRIPTION_SAVED",
            created,
            warnings,
          };
        }

        const outstanding = await tx.clinicalOrder.count({
          where: {
            visitId: id,
            type: { in: ["LABORATORY", "IMAGING"] },
            status: { in: ["REQUESTED", "IN_PROGRESS"] },
          },
        });
        if (outstanding && !["REFER", "DECEASED", "AGAINST_MEDICAL_ADVICE", "OTHER"].includes(input.data.disposition))
          throw Object.assign(
            new Error(
              "Review all requested investigation results before signing",
            ),
            { status: 409 },
          );
        const medicines = await tx.clinicalOrder.count({
          where: { visitId: id, type: "MEDICATION", status: { in: ["REQUESTED", "IN_PROGRESS"] } },
        });
        if (input.data.disposition === "REFER") {
          const sentReferral = await tx.referral.findFirst({
            where: { visitId: id, status: { in: ["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"] } },
            select: { id: true },
          });
          if (!sentReferral)
            throw Object.assign(new Error("Create and send the referral before signing a REFER disposition"), { status: 409 });
        }
        const target = dispositionVisitStatus(input.data.disposition, medicines);
        const outcome = normalizedVisitOutcome(input.data.disposition);
        let savedPlan: Record<string, unknown> = {};
        try { savedPlan = JSON.parse(encounter.plan || "{}"); } catch { savedPlan = { plan: encounter.plan }; }
        if (typeof savedPlan.plan !== "string" || savedPlan.plan.trim().length < 2)
          throw Object.assign(new Error("Save a management plan before signing"), { status: 422 });
        await tx.encounter.update({
          where: { id: encounter.id },
          data: { status: "SIGNED", clinicianId: user.id, signedAt: new Date(), plan: JSON.stringify({ ...savedPlan, disposition: input.data.disposition, dispositionDetails: input.data.dispositionDetails || null }) },
        });
        if (target === "DISCHARGED") {
          if (!input.data.dispositionDetails || input.data.dispositionDetails.trim().length < 10)
            throw Object.assign(new Error("Document the closure circumstances and handover plan"), { status: 422 });
          await closeClinicalVisit(tx, user, id, { outcome: outcome!, details: input.data.dispositionDetails, cancelPendingOrders: input.data.cancelPendingOrders });
          await appendAudit(tx, { facilityId: user.facilityId, userId: user.id, sessionId: user.sessionId, action: "CONSULTATION_SIGNED", entityType: "Encounter", entityId: encounter.id, afterHash: `${visit.visitNumber}:${target}` });
          return { stage: "SIGNED", target };
        }
        await tx.queueEntry.updateMany({
          where: {
            visitId: id,
            servicePoint: "CONSULTATION",
            status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] },
          },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        if (target === "AWAITING_PHARMACY")
          await ensureServiceTask(tx, visit, "PHARMACY");
        if (target === "AWAITING_PAYMENT")
          await ensureServiceTask(tx, visit, "BILLING");
        await tx.visit.update({ where: { id }, data: { status: target } });
        // A consultation plan is not final discharge. A clinician closes the visit explicitly.
        await appendAudit(tx, {
          userId: user.id,
          action: "CONSULTATION_SIGNED",
          entityType: "Encounter",
          entityId: encounter.id,
          reason: outcome ? JSON.stringify({ outcome, details: input.data.dispositionDetails || null }) : undefined,
          afterHash: `${visit.visitNumber}:${target}`,
        });
        return { stage: "SIGNED", target };
      },
    );
    return privateJson(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target);
      if (target.includes("idempotencyKey"))
        return privateJson({ error: "Another save is being confirmed. Retry the unchanged prescription request to verify its result." }, { status: 409 });
      if (target.includes("visitMedicationKey"))
        return NextResponse.json({ error: "This medicine is already prescribed in this visit. Edit the existing prescription instead." }, { status: 409 });
    }
    return apiError(error);
  }
}
