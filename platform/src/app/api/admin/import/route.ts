import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode, laboratoryDisplayName } from "@/lib/laboratory";
import { normalizeName } from "@/lib/security";
import { normalizeMedicationConcept } from "@/lib/medication";
import { patientNumber } from "@/lib/domain";
import { parseCsv } from "@/lib/csv";

const datasetSchema = z.enum([
  "PATIENTS",
  "LAB_TESTS",
  "PROCEDURES",
  "PHARMACEUTICALS",
  "NON_PHARMACEUTICALS",
  "LAB_REFERENCE_RANGES",
]);
const requestSchema = z.object({
  dataset: datasetSchema,
  csv: z.string().min(1).max(5_000_000),
  publish: z.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  sourceTitle: z.string().trim().max(255).optional(),
  sheetTitle: z.string().trim().max(100).optional(),
});
type Row = ReturnType<typeof parseCsv>[number];
const number = (value: string) => (value === "" ? undefined : Number(value));

function validate(row: Row, dataset: z.infer<typeof datasetSchema>) {
  const value = row.values;
  const errors: string[] = [];
  const required =
    dataset === "PATIENTS"
      ? ["full_name", "sex_at_birth", "phone", "county", "subcounty"]
      : dataset === "LAB_REFERENCE_RANGES"
        ? ["test_code", "analyte"]
        : ["code", "name", "unit_price"];
  for (const field of required)
    if (!value[field]) errors.push(`${field} is required`);
  if (
    dataset === "PATIENTS" &&
    !value.date_of_birth &&
    !value.estimated_age_years
  )
    errors.push("date_of_birth or estimated_age_years is required");
  if (
    dataset === "PATIENTS" &&
    !["FEMALE", "MALE", "INTERSEX", "UNKNOWN"].includes(
      value.sex_at_birth?.toUpperCase(),
    )
  )
    errors.push("sex_at_birth is invalid");
  if (
    value.unit_price &&
    (!Number.isFinite(Number(value.unit_price)) || Number(value.unit_price) < 0)
  )
    errors.push("unit_price must be zero or greater");
  if (value.cost_price && (!Number.isFinite(Number(value.cost_price)) || Number(value.cost_price) < 0))
    errors.push("cost_price must be zero or greater");
  if (value.opening_quantity && (!Number.isFinite(Number(value.opening_quantity)) || Number(value.opening_quantity) < 0))
    errors.push("opening_quantity must be zero or greater");
  if (dataset === "PHARMACEUTICALS" && Number(value.opening_quantity) > 0) {
    if (!value.batch_number) errors.push("batch_number is required when opening_quantity is provided");
    if (!value.expiry_date || Number.isNaN(new Date(value.expiry_date).getTime())) errors.push("a valid expiry_date is required when opening_quantity is provided");
  }
  for (const field of [
    "min_age_days",
    "max_age_days",
    "lower_limit",
    "upper_limit",
    "critical_low",
    "critical_high",
    "reorder_level",
    "display_order",
    "turnaround_minutes",
    "pack_size",
  ])
    if (value[field] && !Number.isFinite(Number(value[field])))
      errors.push(`${field} must be numeric`);
  if (dataset === "LAB_TESTS" && !value.specimen_type)
    errors.push("specimen_type is required");
  if (
    ["PHARMACEUTICALS", "NON_PHARMACEUTICALS"].includes(dataset) &&
    !value.unit_of_measure
  )
    errors.push("unit_of_measure is required");
  return errors;
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.catalog");
    const input = requestSchema.parse(await request.json());
    const rows = parseCsv(input.csv);
    if (!rows.length)
      return NextResponse.json(
        { error: "The CSV has headers but no data rows" },
        { status: 422 },
      );
    if (rows.length > 10000)
      return NextResponse.json(
        { error: "A single import is limited to 10,000 rows" },
        { status: 422 },
      );
    const preview = rows.map((row) => ({
      ...row,
      errors: validate(row, input.dataset),
    }));
    const invalid = preview.filter((row) => row.errors.length);
    if (!input.publish || invalid.length) {
      const start = (input.page - 1) * input.pageSize;
      return NextResponse.json({
        preview: preview.slice(start, start + input.pageSize),
        total: rows.length,
        valid: rows.length - invalid.length,
        invalid: invalid.length,
        publishable: invalid.length === 0,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(rows.length / input.pageSize)),
      });
    }
    const imported = await db.$transaction(
      async (tx) => {
        let count = 0;
        let skippedDuplicates = 0;
        let openingStockSkipped = 0;
        if (input.dataset === "PATIENTS") {
          const facility = await tx.facility.findUniqueOrThrow({
            where: { id: user.facilityId },
          });
          const year = new Date().getFullYear();
          for (const row of rows) {
            const v = row.values;
            const existing = await tx.patient.findFirst({
              where: {
                facilityId: user.facilityId,
                OR: [
                  { contacts: { some: { value: v.phone } } },
                  ...(v.national_id
                    ? [
                        {
                          identifiers: {
                            some: { type: "NATIONAL_ID", value: v.national_id },
                          },
                        },
                      ]
                    : []),
                ],
              },
            });
            if (existing) { skippedDuplicates++; continue; }
            const sequence = await tx.referenceSequence.upsert({
              where: {
                facilityId_kind_year: {
                  facilityId: user.facilityId,
                  kind: "PATIENT",
                  year,
                },
              },
              update: { nextValue: { increment: 1 } },
              create: {
                facilityId: user.facilityId,
                kind: "PATIENT",
                year,
                nextValue: 2,
              },
            });
            const assigned = patientNumber(
              facility.code,
              year,
              sequence.nextValue - 1n,
            );
            const nameParts = v.full_name.trim().split(/\s+/);
            await tx.patient.create({
              data: {
                facilityId: user.facilityId,
                patientNumber: assigned,
                givenName: nameParts[0] || null,
                middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : null,
                familyName: nameParts.length > 1 ? nameParts.at(-1) : null,
                fullName: v.full_name,
                normalizedName: normalizeName(v.full_name),
                dateOfBirth: v.date_of_birth ? new Date(v.date_of_birth) : null,
                estimatedAgeYears: v.estimated_age_years
                  ? Number(v.estimated_age_years)
                  : null,
                sexAtBirth: v.sex_at_birth.toUpperCase() as
                  | "FEMALE"
                  | "MALE"
                  | "INTERSEX"
                  | "UNKNOWN",
                preferredLanguage: v.preferred_language || "English",
                contacts: {
                  create: { type: "PHONE", value: v.phone, primary: true },
                },
                identifiers: {
                  create: [
                    { type: "PHONE", value: v.phone },
                    ...(v.national_id
                      ? [{ type: "NATIONAL_ID", value: v.national_id }]
                      : []),
                    ...(v.sha_number
                      ? [{ type: "SHA", value: v.sha_number }]
                      : []),
                  ],
                },
                addresses: {
                  create: {
                    county: v.county,
                    subcounty: v.subcounty,
                    ward: v.ward || null,
                    village: v.village || null,
                  },
                },
                consents: {
                  create: [
                    { type: "TREATMENT", granted: true, recordedById: user.id },
                    {
                      type: "ELECTRONIC_RECORD",
                      granted: true,
                      recordedById: user.id,
                    },
                  ],
                },
              },
            });
            count++;
          }
        } else if (input.dataset === "LAB_REFERENCE_RANGES") {
          for (const row of rows) {
            const v = row.values;
            const test = await tx.catalogItem.findFirst({
              where: {
                facilityId: user.facilityId,
                category: "LABORATORY_TEST",
                code: v.test_code.toUpperCase(),
              },
            });
            if (!test)
              throw Object.assign(
                new Error(
                  `Row ${row.rowNumber}: laboratory test ${v.test_code} does not exist`,
                ),
                { status: 422 },
              );
            await tx.labReferenceRange.create({
              data: {
                catalogItemId: test.id,
                analyte: v.analyte,
                componentCode: v.component_code || null,
                loincCode: v.loinc_code || null,
                unit: v.unit || null,
                unitUcum: v.unit_ucum || null,
                displayOrder: number(v.display_order) || 0,
                sexAtBirth: v.sex_at_birth?.toUpperCase() || "ANY",
                minAgeDays: number(v.min_age_days),
                maxAgeDays: number(v.max_age_days),
                lowerLimit: v.lower_limit
                  ? new Prisma.Decimal(v.lower_limit)
                  : null,
                upperLimit: v.upper_limit
                  ? new Prisma.Decimal(v.upper_limit)
                  : null,
                criticalLow: v.critical_low
                  ? new Prisma.Decimal(v.critical_low)
                  : null,
                criticalHigh: v.critical_high
                  ? new Prisma.Decimal(v.critical_high)
                  : null,
                qualitativeValues: v.qualitative_values || null,
                analyser: v.analyser || null,
                method: v.method || null,
                pregnancyStage: v.pregnancy_stage || null,
                approvedBy: v.approved_by || null,
                source: v.source || null,
                verifiedAt: new Date(),
              },
            });
            count++;
          }
        } else {
          const categories = {
            LAB_TESTS: "LABORATORY_TEST",
            PROCEDURES: "PROCEDURE",
            PHARMACEUTICALS: "PHARMACEUTICAL",
            NON_PHARMACEUTICALS: "NON_PHARMACEUTICAL",
          } as const;
          const category = categories[input.dataset];
          for (const row of rows) {
            const v = row.values;
            const normalizedCode = category === "LABORATORY_TEST" ? canonicalLaboratoryCode(v.code) : v.code.toUpperCase();
            const catalogItem = await tx.catalogItem.upsert({
              where: {
                facilityId_code: {
                  facilityId: user.facilityId,
                  code: normalizedCode,
                },
              },
              update: {
                category,
                name: normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : v.name,
                description: v.description || null,
                unitPrice: new Prisma.Decimal(v.unit_price),
                costPrice: v.cost_price ? new Prisma.Decimal(v.cost_price) : null,
                packSize: v.pack_size ? new Prisma.Decimal(v.pack_size) : null,
                active: v.active?.toLowerCase() !== "false",
                specimenType: v.specimen_type || null,
                synonyms: v.synonyms || null,
                loincCode: v.loinc_code || null,
                department: v.department || null,
                panelOrSingle: v.panel_or_single || null,
                container: v.container || null,
                method: v.method || null,
                turnaroundMinutes: number(v.turnaround_minutes),
                reportableToKhis: Boolean(v.khis_mapping),
                khisMapping: v.khis_mapping || null,
                modality: v.modality || null,
                genericName: v.generic_name || null,
                medicationConceptId: category === "PHARMACEUTICAL" && v.generic_name ? normalizeMedicationConcept(v.generic_name) : null,
                strength: v.strength || null,
                dosageForm: v.dosage_form || null,
                unitOfMeasure: v.unit_of_measure || null,
                reorderLevel: v.reorder_level
                  ? new Prisma.Decimal(v.reorder_level)
                  : null,
              },
              create: {
                facilityId: user.facilityId,
                category,
                code: normalizedCode,
                name: normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : v.name,
                description: v.description || null,
                unitPrice: new Prisma.Decimal(v.unit_price),
                costPrice: v.cost_price ? new Prisma.Decimal(v.cost_price) : null,
                packSize: v.pack_size ? new Prisma.Decimal(v.pack_size) : null,
                active: v.active?.toLowerCase() !== "false",
                specimenType: v.specimen_type || null,
                synonyms: v.synonyms || null,
                loincCode: v.loinc_code || null,
                department: v.department || null,
                panelOrSingle: v.panel_or_single || null,
                container: v.container || null,
                method: v.method || null,
                turnaroundMinutes: number(v.turnaround_minutes),
                reportableToKhis: Boolean(v.khis_mapping),
                khisMapping: v.khis_mapping || null,
                modality: v.modality || null,
                genericName: v.generic_name || null,
                medicationConceptId: category === "PHARMACEUTICAL" && v.generic_name ? normalizeMedicationConcept(v.generic_name) : null,
                strength: v.strength || null,
                dosageForm: v.dosage_form || null,
                unitOfMeasure: v.unit_of_measure || null,
                reorderLevel: v.reorder_level
                  ? new Prisma.Decimal(v.reorder_level)
                  : null,
              },
            });
            if (category === "PHARMACEUTICAL" && Number(v.opening_quantity) > 0) {
              const expiryDate = new Date(v.expiry_date);
              if (expiryDate <= new Date()) throw Object.assign(new Error(`Row ${row.rowNumber}: opening stock expiry date must be in the future`), { status: 422 });
              const storeCode = (v.store_code || "MAIN").toUpperCase();
              const store = await tx.store.upsert({ where: { facilityId_code: { facilityId: user.facilityId, code: storeCode } }, update: { active: true }, create: { facilityId: user.facilityId, code: storeCode, name: storeCode === "MAIN" ? "Main pharmacy store" : storeCode } });
              const exists = await tx.inventoryBatch.findUnique({ where: { catalogItemId_batchNumber: { catalogItemId: catalogItem.id, batchNumber: v.batch_number } } });
              if (!exists) {
                const batch = await tx.inventoryBatch.create({ data: { catalogItemId: catalogItem.id, batchNumber: v.batch_number, expiryDate, quantityReceived: new Prisma.Decimal(v.opening_quantity), quantityAvailable: new Prisma.Decimal(v.opening_quantity), unitCost: v.cost_price ? new Prisma.Decimal(v.cost_price) : null } });
                await tx.inventoryLocationBalance.create({ data: { storeId: store.id, batchId: batch.id, quantity: new Prisma.Decimal(v.opening_quantity) } });
                await tx.stockMovement.create({ data: { batchId: batch.id, userId: user.id, type: "OPENING_BALANCE", quantity: new Prisma.Decimal(v.opening_quantity), balanceAfter: new Prisma.Decimal(v.opening_quantity), reason: `Migration import · ${input.sourceTitle || "spreadsheet"}` } });
              } else openingStockSkipped++;
            }
            count++;
          }
        }
        await appendAudit(tx, {
          userId: user.id,
          action: "SPREADSHEET_DATASET_PUBLISHED",
          entityType: "Facility",
          entityId: user.facilityId,
          reason:
            [input.sourceTitle, input.sheetTitle].filter(Boolean).join(" · ") ||
            undefined,
          afterHash: `${input.dataset}:${count}:${skippedDuplicates}:${openingStockSkipped}`,
        });
        return { count, skippedDuplicates, openingStockSkipped };
      },
      { timeout: 120000 },
    );
    return NextResponse.json({ imported: imported.count, skippedDuplicates: imported.skippedDuplicates, openingStockSkipped: imported.openingStockSkipped, dataset: input.dataset });
  } catch (error) {
    return apiError(error);
  }
}
