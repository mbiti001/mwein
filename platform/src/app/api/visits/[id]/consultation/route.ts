import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode } from "@/lib/laboratory";
import { verifyDiagnosisSelectionToken } from "@/lib/diagnosis-selection";
import { normalizeMedicationConcept, periodsOverlap, prescriptionSnapshot, sameVisitMedicationKey, treatmentStopDate } from "@/lib/medication";
import { evaluateMedicationSafety, medicationSafetyContextHash } from "@/lib/medication-safety";
import { effectiveCatalogPrice } from "@/lib/catalog-pricing";
import {
  consultationNotesSchema,
  diagnosisSchema,
  investigationOrderSchema,
  prescriptionSchema,
  signConsultationSchema,
} from "@/lib/consultation";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_NOTES"), data: consultationNotesSchema }),
  z.object({ action: z.literal("SAVE_DIAGNOSIS"), data: diagnosisSchema }),
  z.object({
    action: z.literal("SUBMIT_INVESTIGATIONS"),
    data: investigationOrderSchema,
  }),
  z.object({
    action: z.literal("SAVE_PRESCRIPTION"),
    data: prescriptionSchema,
  }),
  z.object({ action: z.literal("SIGN"), data: signConsultationSchema }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission("encounter.write");
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    const result = await db.$transaction(
      async (tx) => {
        const visit = await tx.visit.findFirst({
          where: { id, facilityId: user.facilityId },
          include: {
            invoice: true,
            encounters: { orderBy: { createdAt: "desc" } },
            patient: { include: { allergies: { where: { active: true } } } },
            orders: { include: { laboratory: true, imaging: true, prescription: true, invoiceItem: true } },
          },
        });
        if (!visit)
          throw Object.assign(new Error("Visit not found"), { status: 404 });
        if (["CANCELLED", "COMPLETED"].includes(visit.status))
          throw Object.assign(new Error("This visit is closed and cannot be changed"), { status: 409 });
        if (visit.encounters.some((item) => item.status === "SIGNED"))
          throw Object.assign(
            new Error("This consultation is already signed"),
            { status: 409 },
          );
        let encounter = visit.encounters.find(
          (item) => item.status === "DRAFT",
        );

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
            }),
          };
          encounter = encounter
            ? await tx.encounter.update({ where: { id: encounter.id }, data })
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
            action: "CONSULTATION_DRAFT_SAVED",
            entityType: "Encounter",
            entityId: encounter.id,
          });
          return { stage: "NOTES_SAVED" };
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
              primary: input.data.primary,
            },
          });
          await tx.encounter.update({
            where: { id: encounter.id },
            data: { assessment: input.data.title },
          });
          await appendAudit(tx, {
            userId: user.id,
            action: "ICD11_DIAGNOSIS_RECORDED",
            entityType: "Diagnosis",
            entityId: diagnosis.id,
            afterHash: `${diagnosis.code}:${diagnosis.description}`,
          });
          return { stage: "DIAGNOSIS_SAVED", diagnosis };
        }

        const primary = await tx.diagnosis.findFirst({
          where: {
            encounterId: encounter.id,
            primary: true,
            codingSystem: "ICD-11 MMS",
            code: { not: null },
          },
        });
        if (!primary)
          throw Object.assign(
            new Error(
              "Record a primary ICD-11 diagnosis before ordering or prescribing",
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
                value.category === "PROCEDURE",
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
            await tx.queueEntry.create({
              data: {
                visitId: id,
                servicePoint: "LABORATORY",
                priority: visit.priority,
              },
            });
          if (input.data.imaging.length)
            await tx.queueEntry.create({
              data: {
                visitId: id,
                servicePoint: "IMAGING",
                priority: visit.priority,
              },
            });
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
          if (idempotent?.order.visitId === id)
            return { stage: "PRESCRIPTION_ALREADY_SAVED", created: [idempotent.order.displayName], warnings: [] };
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
            tx.prescription.findMany({ where: { medicationConceptId: { not: null }, order: { visit: { patientId: visit.patientId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } } }, select: { medicationConceptId: true } }),
          ]);
          const activeMedicationConcepts = activePatientPrescriptions.flatMap(item => item.medicationConceptId ? [item.medicationConceptId] : []);
          for (const medicine of input.data.prescriptions) {
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
            const medicationConceptId = item.medicationConceptId || normalizeMedicationConcept(item.genericName);
            const safetyContext = {
              medicationConceptId,
              patientAllergyConcepts: visit.patient.allergies.map(record => normalizeMedicationConcept(record.substance)),
              activeMedicationConcepts,
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
                order: { visit: { patientId: visit.patientId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } },
              },
              include: { order: { include: { invoiceItem: true } }, catalogItem: true },
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
            if (sameVisit && !input.data.duplicateAction)
              throw Object.assign(new Error(`${sameVisit.order.displayName} is already prescribed in this visit. Edit the existing prescription instead.`), {
                status: 409,
                details: { code: "SAME_VISIT_DUPLICATE", existingOrderId: sameVisit.order.id, existingPrescriptionId: sameVisit.id, existing: prescriptionSnapshot({ ...sameVisit, quantity: Number(sameVisit.quantity) }), options: ["EDIT_EXISTING", "CANCEL"] },
              });
            if (sameVisit && input.data.duplicateAction && input.data.duplicateAction !== "EDIT_EXISTING")
              throw Object.assign(new Error("The same medicine cannot be prescribed twice in one visit. Edit the existing prescription instead."), { status: 409 });
            const duplicate = sameVisit || exact;
            if (duplicate && !sameVisit && !input.data.duplicateAction)
              throw Object.assign(new Error(`Active duplicate found: ${duplicate.order.displayName}`), {
                status: 409,
                details: { code: "EXACT_DUPLICATE", existingOrderId: duplicate.order.id, existingPrescriptionId: duplicate.id, existing: prescriptionSnapshot({ ...duplicate, quantity: Number(duplicate.quantity) }), options: ["EDIT_EXISTING", "REPLACE_EXISTING", "KEEP_BOTH", "CANCEL"] },
              });
            if (duplicate && input.data.duplicateAction && !input.data.duplicateReason)
              throw Object.assign(new Error("Record a clinical reason for the duplicate decision"), { status: 422 });

            if (duplicate && ["EDIT_EXISTING", "REPLACE_EXISTING"].includes(input.data.duplicateAction || "")) {
              const original = prescriptionSnapshot({ ...duplicate, quantity: Number(duplicate.quantity) });
              const updated = await tx.prescription.update({ where: { id: duplicate.id }, data: {
                catalogItemId: item.id, medicationConceptId, genericName: item.genericName, strength: item.strength, dosageForm: item.dosageForm,
                dose: medicine.dose, route: medicine.route, frequency: medicine.frequency, duration: medicine.duration,
                doseQuantity: medicine.doseQuantity ? new Prisma.Decimal(medicine.doseQuantity) : undefined, frequencyPerDay: medicine.frequencyPerDay, durationDays: medicine.durationDays, quantityConfirmed: medicine.quantityConfirmed,
                startDate, stopDate, quantity: new Prisma.Decimal(medicine.quantity), instructions: medicine.instructions,
                isPrn: false, prnIndication: null, doseTiming: medicine.doseTiming, sequenceNote: medicine.sequenceNote,
                encounterId: encounter.id, diagnosisId: primary.id, idempotencyKey: input.data.idempotencyKey,
                ...(sameVisit ? { visitMedicationKey: sameVisitMedicationKey(id, medicationConceptId) } : {}),
              } });
              await tx.clinicalOrder.update({ where: { id: duplicate.order.id }, data: { orderedById: user.id, displayName: item.name, clinicalIndication: medicine.indication, status: input.data.submit ? "REQUESTED" : "DRAFT" } });
              if (duplicate.order.invoiceItem) {
                const alreadyDispensed = Number(duplicate.dispensedQuantity || 0);
                const price = effectiveCatalogPrice(item, now);
                if (alreadyDispensed > 0)
                  await tx.invoiceItem.update({ where: { id: duplicate.order.invoiceItem.id }, data: { quantity: new Prisma.Decimal(alreadyDispensed), unitPrice: new Prisma.Decimal(Number(price.unitPrice)), catalogItemId: item.id, priceVersionId: price.priceVersionId, description: item.name } });
                else await tx.invoiceItem.delete({ where: { id: duplicate.order.invoiceItem.id } });
              }
              await tx.medicationSafetyOverride.create({ data: { prescriptionId: updated.id, existingPrescriptionId: duplicate.id, prescriberId: user.id, warningCode: sameVisit ? "SAME_VISIT_EDIT" : input.data.duplicateAction!, justification: input.data.duplicateReason!, originalDetails: original, revisedDetails: revised } });
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
                    diagnosisId: primary.id,
                    idempotencyKey: input.data.idempotencyKey,
                    visitMedicationKey: sameVisitMedicationKey(id, medicationConceptId),
                  },
                },
              },
              include: { prescription: true },
            });
            created.push(item.name);
            if (safetyResults.length) await tx.medicationSafetyAssessment.createMany({ data: safetyResults.map(result => ({ prescriptionId: order.prescription!.id, ruleId: result.ruleId, warningCode: result.warningCode, severity: result.severity, outcome: result.outcome, message: result.message, ruleVersion: result.ruleVersion, contextHash })) });
            if (!activeMedicationConcepts.includes(medicationConceptId)) activeMedicationConcepts.push(medicationConceptId);
            if (exact && input.data.duplicateAction === "KEEP_BOTH")
              await tx.medicationSafetyOverride.create({ data: { prescriptionId: order.prescription!.id, existingPrescriptionId: exact.id, prescriberId: user.id, warningCode: "EXACT_DUPLICATE_OVERRIDDEN", justification: input.data.duplicateReason!, originalDetails: prescriptionSnapshot({ ...exact, quantity: Number(exact.quantity) }), revisedDetails: revised } });
            const sameClass = item.therapeuticClass ? await tx.prescription.findFirst({ where: { id: { not: order.prescription!.id }, catalogItem: { therapeuticClass: item.therapeuticClass }, order: { visit: { patientId: visit.patientId }, status: { in: ["DRAFT", "REQUESTED", "IN_PROGRESS"] } } }, include: { order: true } }) : null;
            if (sameClass) warnings.push(`Therapeutic duplication: ${item.name} and ${sameClass.order.displayName} are both ${item.therapeuticClass}.`);
            const allergy = visit.patient.allergies.find(record => normalizeMedicationConcept(record.substance).includes(medicationConceptId) || medicationConceptId.includes(normalizeMedicationConcept(record.substance)));
            if (allergy) warnings.push(`Allergy warning: ${item.genericName} may match recorded allergy ${allergy.substance}.`);
          }
          await appendAudit(tx, {
            userId: user.id,
            action: input.data.submit
              ? "PRESCRIPTION_SUBMITTED"
              : "PRESCRIPTION_DRAFT_SAVED",
            entityType: "Encounter",
            entityId: encounter.id,
            afterHash: created.join("|"),
          });
          return {
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
        if (outstanding)
          throw Object.assign(
            new Error(
              "Review all requested investigation results before signing",
            ),
            { status: 409 },
          );
        const medicines = await tx.clinicalOrder.count({
          where: { visitId: id, type: "MEDICATION", status: "REQUESTED" },
        });
        if (input.data.disposition === "REFER") {
          const sentReferral = await tx.referral.findFirst({
            where: { visitId: id, status: { in: ["SENT", "ACCEPTED", "ATTENDED", "RETURNED", "CLOSED"] } },
            select: { id: true },
          });
          if (!sentReferral)
            throw Object.assign(new Error("Create and send the referral before signing a REFER disposition"), { status: 409 });
        }
        const target =
          input.data.disposition === "ADMIT"
            ? "ADMITTED"
            : input.data.disposition === "REFER"
              ? "REFERRED"
              : medicines
                ? "AWAITING_PHARMACY"
                : "AWAITING_PAYMENT";
        await tx.encounter.update({
          where: { id: encounter.id },
          data: { status: "SIGNED", signedAt: new Date() },
        });
        await tx.queueEntry.updateMany({
          where: {
            visitId: id,
            servicePoint: "CONSULTATION",
            status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] },
          },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        if (target === "AWAITING_PHARMACY")
          await tx.queueEntry.create({
            data: {
              visitId: id,
              servicePoint: "PHARMACY",
              priority: visit.priority,
            },
          });
        if (target === "AWAITING_PAYMENT")
          await tx.queueEntry.create({
            data: {
              visitId: id,
              servicePoint: "BILLING",
              priority: visit.priority,
            },
          });
        await tx.visit.update({ where: { id }, data: { status: target } });
        await appendAudit(tx, {
          userId: user.id,
          action: "CONSULTATION_SIGNED",
          entityType: "Encounter",
          entityId: encounter.id,
          afterHash: `${visit.visitNumber}:${target}`,
        });
        return { stage: "SIGNED", target };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target);
      if (target.includes("idempotencyKey"))
        return NextResponse.json({ stage: "PRESCRIPTION_ALREADY_SAVED", created: [], warnings: [] });
      if (target.includes("visitMedicationKey"))
        return NextResponse.json({ error: "This medicine is already prescribed in this visit. Edit the existing prescription instead." }, { status: 409 });
    }
    return apiError(error);
  }
}
