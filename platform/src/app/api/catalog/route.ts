import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode, laboratoryDisplayName } from "@/lib/laboratory";
import { normalizeMedicationConcept } from "@/lib/medication";

const category = z.enum([
  "LABORATORY_TEST",
  "PROCEDURE",
  "PHARMACEUTICAL",
  "NON_PHARMACEUTICAL",
]);
const itemSchema = z
  .object({
    category,
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        "Use letters, numbers, dots, dashes or underscores",
      ),
    name: z.string().trim().min(2).max(180),
    description: z.string().trim().max(1000).optional(),
    unitPrice: z.coerce.number().min(0).max(100000000),
    costPrice: z.coerce.number().min(0).max(100000000).optional(),
    packSize: z.coerce.number().positive().max(1000000).optional(),
    specimenType: z.string().trim().max(80).optional(),
    modality: z.string().trim().max(80).optional(),
    genericName: z.string().trim().max(180).optional(),
    medicationConceptId: z.string().trim().max(180).optional(),
    therapeuticClass: z.string().trim().max(180).optional(),
    strength: z.string().trim().max(80).optional(),
    dosageForm: z.string().trim().max(80).optional(),
    unitOfMeasure: z.string().trim().max(80).optional(),
    reorderLevel: z.coerce.number().min(0).max(100000000).optional(),
    active: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.category === "LABORATORY_TEST" && !value.specimenType)
      context.addIssue({
        code: "custom",
        path: ["specimenType"],
        message: "Specimen type is required for a laboratory test",
      });
    if (
      ["PHARMACEUTICAL", "NON_PHARMACEUTICAL"].includes(value.category) &&
      !value.unitOfMeasure
    )
      context.addIssue({
        code: "custom",
        path: ["unitOfMeasure"],
        message: "Unit of measure is required for commodities",
      });
    if (value.category === "PHARMACEUTICAL") {
      for (const field of ["genericName", "strength", "dosageForm"] as const)
        if (!value[field]) context.addIssue({ code: "custom", path: [field], message: `${field} is required for a medicine` });
    }
  });

export async function GET(request: Request) {
  try {
    const user = await requirePermission("visit.read");
    const selected = new URL(request.url).searchParams.get("category");
    const parsed = selected ? category.parse(selected) : undefined;
    const items = await db.catalogItem.findMany({
      where: {
        facilityId: user.facilityId,
        ...(parsed ? { category: parsed } : {}),
      },
      include: {
        referenceRanges: {
          where: { active: true },
          orderBy: [{ displayOrder: "asc" }, { analyte: "asc" }],
        },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.catalog");
    const input = itemSchema.parse(await request.json());
    const normalizedCode = input.category === "LABORATORY_TEST" ? canonicalLaboratoryCode(input.code) : input.code.toUpperCase();
    const normalizedName = normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : input.name;
    const item = await db.$transaction(async (tx) => {
      const created = await tx.catalogItem.create({
        data: {
          facilityId: user.facilityId,
          ...input,
          medicationConceptId: input.category === "PHARMACEUTICAL" ? input.medicationConceptId || normalizeMedicationConcept(input.genericName!) : undefined,
          code: normalizedCode,
          name: normalizedName,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          costPrice: input.costPrice === undefined ? undefined : new Prisma.Decimal(input.costPrice),
          packSize: input.packSize === undefined ? undefined : new Prisma.Decimal(input.packSize),
          reorderLevel:
            input.reorderLevel === undefined
              ? undefined
              : new Prisma.Decimal(input.reorderLevel),
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "CATALOG_ITEM_CREATED",
        entityType: "CatalogItem",
        entityId: created.id,
        afterHash: `${created.category}:${created.code}:${created.unitPrice}`,
      });
      return created;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePermission("admin.catalog");
    const body = await request.json();
    const id = z.uuid().parse(body.id);
    const input = itemSchema.parse(body);
    const normalizedCode = input.category === "LABORATORY_TEST" ? canonicalLaboratoryCode(input.code) : input.code.toUpperCase();
    const existing = await db.catalogItem.findFirst({
      where: { id, facilityId: user.facilityId },
    });
    if (!existing)
      return NextResponse.json(
        { error: "Catalogue item not found" },
        { status: 404 },
      );
    const item = await db.$transaction(async (tx) => {
      const updated = await tx.catalogItem.update({
        where: { id },
        data: {
          ...input,
          medicationConceptId: input.category === "PHARMACEUTICAL" ? input.medicationConceptId || normalizeMedicationConcept(input.genericName!) : null,
          code: normalizedCode,
          name: normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : input.name,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          costPrice: input.costPrice === undefined ? null : new Prisma.Decimal(input.costPrice),
          packSize: input.packSize === undefined ? null : new Prisma.Decimal(input.packSize),
          reorderLevel:
            input.reorderLevel === undefined
              ? null
              : new Prisma.Decimal(input.reorderLevel),
        },
      });
      await appendAudit(tx, {
        userId: user.id,
        action: "CATALOG_ITEM_UPDATED",
        entityType: "CatalogItem",
        entityId: id,
        beforeHash: `${existing.category}:${existing.code}:${existing.unitPrice}:${existing.active}`,
        afterHash: `${updated.category}:${updated.code}:${updated.unitPrice}:${updated.active}`,
      });
      return updated;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
