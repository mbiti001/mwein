import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode } from "@/lib/laboratory";
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
            orders: { include: { laboratory: true, imaging: true } },
          },
        });
        if (!visit)
          throw Object.assign(new Error("Visit not found"), { status: 404 });
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
          const labCodes = input.data.labs.map(canonicalLaboratoryCode);
          const selectedCodes = [...labCodes, ...input.data.imaging.map((code) => code.toUpperCase())];
          const catalogue = await tx.catalogItem.findMany({
            where: {
              facilityId: user.facilityId,
              code: { in: selectedCodes },
              active: true,
            },
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
                displayName: item.name,
                clinicalIndication: `${primary.code} ${primary.description}`,
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
                unitPrice: item.unitPrice,
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
                displayName: item.name,
                clinicalIndication: `${primary.code} ${primary.description}`,
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
                unitPrice: item.unitPrice,
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
          });
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
            const order = await tx.clinicalOrder.create({
              data: {
                visitId: id,
                orderedById: user.id,
                type: "MEDICATION",
                status: input.data.submit ? "REQUESTED" : "DRAFT",
                displayName: item.name,
                clinicalIndication: `${primary.code} ${primary.description}`,
                prescription: {
                  create: {
                    medicineCode: medicine.medicineCode,
                    dose: medicine.dose,
                    route: medicine.route,
                    frequency: medicine.frequency,
                    duration: medicine.duration,
                    quantity: new Prisma.Decimal(medicine.quantity),
                    instructions: medicine.instructions,
                  },
                },
              },
            });
            if (input.data.submit)
              await tx.invoiceItem.create({
                data: {
                  invoiceId: visit.invoice!.id,
                  orderId: order.id,
                  serviceCode: `MED-${medicine.medicineCode}`,
                  description: item.name,
                  quantity: new Prisma.Decimal(medicine.quantity),
                  unitPrice: item.unitPrice,
                },
              });
            created.push(item.name);
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
    return apiError(error);
  }
}
