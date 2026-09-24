import { auditedOperationalJson } from "@/lib/audited-json";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { appendAudit } from "@/lib/audit";
import { canonicalLaboratoryCode, laboratoryDisplayName } from "@/lib/laboratory";
import { normalizeMedicationConcept } from "@/lib/medication";
import { effectiveCatalogPrice, kenyaEffectiveDate, nextCatalogPrice, nairobiDateInputValue } from "@/lib/catalog-pricing";

const category = z.enum([
  "LABORATORY_TEST",
  "PROCEDURE",
  "PHARMACEUTICAL",
  "NON_PHARMACEUTICAL",
]);
const effectiveTimestamp = (value: string, now = new Date()) =>
  value === nairobiDateInputValue(now) ? now : kenyaEffectiveDate(value);
const optionalText = (max: number) => z.preprocess(
  (value) => value == null || value === "" ? undefined : value,
  z.string().trim().max(max).optional(),
);
const optionalNumber = (schema: z.ZodNumber) => z.preprocess(
  (value) => value == null || value === "" ? undefined : value,
  z.coerce.number().pipe(schema).optional(),
);
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
    description: optionalText(1000),
    unitPrice: z.coerce.number().min(0).max(100000000),
    costPrice: optionalNumber(z.number().min(0).max(100000000)),
    packSize: optionalNumber(z.number().positive().max(1000000)),
    specimenType: optionalText(80),
    modality: optionalText(80),
    genericName: optionalText(180),
    medicationConceptId: optionalText(180),
    therapeuticClass: optionalText(180),
    strength: optionalText(80),
    dosageForm: optionalText(80),
    unitOfMeasure: optionalText(80),
    reorderLevel: optionalNumber(z.number().min(0).max(100000000)),
    active: z.boolean().default(true),
    priceEffectiveFrom: z.preprocess((value) => value == null || value === "" ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    priceChangeReason: z.preprocess((value) => value == null || value === "" ? undefined : value, z.string().trim().min(5).max(300).optional()),
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
        priceVersions: { orderBy: { effectiveFrom: "desc" } },
        referenceRanges: {
          where: { active: true },
          orderBy: [{ displayOrder: "asc" }, { analyte: "asc" }],
        },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const now = new Date();
    return await auditedOperationalJson(user, "catalog", {
      items: items.map((item) => {
        const current = effectiveCatalogPrice(item, now);
        const upcoming = nextCatalogPrice(item, now);
        return {
          ...item,
          unitPrice: current.unitPrice,
          costPrice: current.costPrice,
          currentPriceEffectiveFrom: current.effectiveFrom,
          upcomingPrice: upcoming,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("admin.catalog");
    const input = itemSchema.parse(await request.json());
    const { priceEffectiveFrom: _priceEffectiveFrom, priceChangeReason: _priceChangeReason, ...catalogInput } = input;
    const normalizedCode = input.category === "LABORATORY_TEST" ? canonicalLaboratoryCode(input.code) : input.code.toUpperCase();
    const normalizedName = normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : input.name;
    const now = new Date();
    const effectiveFrom = effectiveTimestamp(input.priceEffectiveFrom || nairobiDateInputValue(now), now);
    if (effectiveFrom.getTime() > Date.now()) throw Object.assign(new Error("Create the item with today's price, then schedule a future change after saving it"), { status: 422 });
    const item = await db.$transaction(async (tx) => {
      const created = await tx.catalogItem.create({
        data: {
          facilityId: user.facilityId,
          ...catalogInput,
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
      await tx.catalogPriceVersion.create({
        data: {
          facilityId: user.facilityId,
          catalogItemId: created.id,
          unitPrice: created.unitPrice,
          costPrice: created.costPrice,
          currency: created.currency,
          effectiveFrom,
          reason: input.priceChangeReason || "Initial catalogue price",
          createdById: user.id,
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
    const { priceEffectiveFrom: _priceEffectiveFrom, priceChangeReason: _priceChangeReason, ...catalogInput } = input;
    const normalizedCode = input.category === "LABORATORY_TEST" ? canonicalLaboratoryCode(input.code) : input.code.toUpperCase();
    const existing = await db.catalogItem.findFirst({
      where: { id, facilityId: user.facilityId },
      include: { priceVersions: { orderBy: { effectiveFrom: "desc" } } },
    });
    if (!existing)
      return NextResponse.json(
        { error: "Catalogue item not found" },
        { status: 404 },
      );
    const now = new Date();
    const currentPrice = effectiveCatalogPrice(existing, now);
    const sameCost = input.costPrice === undefined
      ? currentPrice.costPrice == null
      : Number(input.costPrice) === Number(currentPrice.costPrice);
    const priceChanged = Number(input.unitPrice) !== Number(currentPrice.unitPrice) || !sameCost;
    const effectiveFrom = effectiveTimestamp(input.priceEffectiveFrom || nairobiDateInputValue(now), now);
    if (priceChanged && !input.priceChangeReason) throw Object.assign(new Error("Record a reason for the price change"), { status: 422 });
    if (effectiveFrom.getTime() < now.getTime() - 366 * 24 * 60 * 60 * 1000) throw Object.assign(new Error("Price changes cannot be backdated by more than one year"), { status: 422 });
    if (effectiveFrom.getTime() > now.getTime() + 730 * 24 * 60 * 60 * 1000) throw Object.assign(new Error("Price changes cannot be scheduled more than two years ahead"), { status: 422 });
    const futureChange = effectiveFrom.getTime() > now.getTime();
    const item = await db.$transaction(async (tx) => {
      if (!existing.priceVersions.length) {
        await tx.catalogPriceVersion.create({
          data: {
            facilityId: user.facilityId,
            catalogItemId: id,
            unitPrice: existing.unitPrice,
            costPrice: existing.costPrice,
            currency: existing.currency,
            effectiveFrom: existing.createdAt,
            reason: "Baseline captured before the first governed price change",
            createdById: user.id,
          },
        });
      }
      const updated = await tx.catalogItem.update({
        where: { id },
        data: {
          ...catalogInput,
          medicationConceptId: input.category === "PHARMACEUTICAL" ? input.medicationConceptId || normalizeMedicationConcept(input.genericName!) : null,
          code: normalizedCode,
          name: normalizedCode === "FBC" ? laboratoryDisplayName(normalizedCode) : input.name,
          unitPrice: new Prisma.Decimal(futureChange ? Number(currentPrice.unitPrice) : input.unitPrice),
          costPrice: futureChange
            ? currentPrice.costPrice == null ? null : new Prisma.Decimal(Number(currentPrice.costPrice))
            : input.costPrice === undefined ? null : new Prisma.Decimal(input.costPrice),
          packSize: input.packSize === undefined ? null : new Prisma.Decimal(input.packSize),
          reorderLevel:
            input.reorderLevel === undefined
              ? null
              : new Prisma.Decimal(input.reorderLevel),
        },
      });
      if (priceChanged) {
        const scheduled = await tx.catalogPriceVersion.findUnique({
          where: { catalogItemId_effectiveFrom: { catalogItemId: id, effectiveFrom } },
        });
        if (scheduled && scheduled.effectiveFrom <= now) {
          throw Object.assign(new Error("A locked price already exists for this effective date"), { status: 409 });
        }
        if (scheduled) {
          await tx.catalogPriceVersion.update({
            where: { id: scheduled.id },
            data: {
              unitPrice: new Prisma.Decimal(input.unitPrice),
              costPrice: input.costPrice === undefined ? null : new Prisma.Decimal(input.costPrice),
              reason: input.priceChangeReason!,
              createdById: user.id,
            },
          });
        } else {
          await tx.catalogPriceVersion.create({
            data: {
              facilityId: user.facilityId,
              catalogItemId: id,
              unitPrice: new Prisma.Decimal(input.unitPrice),
              costPrice: input.costPrice === undefined ? null : new Prisma.Decimal(input.costPrice),
              currency: existing.currency,
              effectiveFrom,
              reason: input.priceChangeReason!,
              createdById: user.id,
            },
          });
        }
      }
      await appendAudit(tx, {
        userId: user.id,
        action: priceChanged ? futureChange ? "CATALOG_PRICE_SCHEDULED" : "CATALOG_PRICE_CHANGED" : "CATALOG_ITEM_UPDATED",
        entityType: "CatalogItem",
        entityId: id,
        beforeHash: `${existing.category}:${existing.code}:${existing.unitPrice}:${existing.active}`,
        afterHash: `${updated.category}:${updated.code}:${priceChanged ? input.unitPrice : updated.unitPrice}:${updated.active}:${priceChanged ? effectiveFrom.toISOString() : "no-price-change"}`,
      });
      return updated;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
