import { Prisma } from "@prisma/client";

export const inventoryAccounts = {
  inventory: { code: "1300", name: "Pharmacy inventory" },
  goodsReceived: { code: "2105", name: "Goods received not invoiced" },
  openingEquity: { code: "3005", name: "Opening inventory equity" },
  costOfGoodsSold: { code: "5000", name: "Pharmacy cost of goods sold" },
  stockLoss: { code: "5090", name: "Stock loss and shrinkage" },
  stockGain: { code: "4090", name: "Stock count gain" },
} as const;

export type InventoryPosting = {
  amount: number;
  debit: { code: string; name: string };
  credit: { code: string; name: string };
};

export function weightedAverageUnitCost(
  existingQuantity: number,
  existingUnitCost: number | null,
  receivedQuantity: number,
  receivedUnitCost: number,
) {
  if (![existingQuantity, receivedQuantity, receivedUnitCost].every(Number.isFinite))
    throw new Error("Inventory quantities and cost must be valid numbers");
  if (existingQuantity < 0 || receivedQuantity <= 0 || receivedUnitCost <= 0)
    throw new Error("Receipt quantity and unit cost must be positive");
  if (existingQuantity === 0 || existingUnitCost == null) return receivedUnitCost;
  if (!Number.isFinite(existingUnitCost) || existingUnitCost <= 0)
    throw new Error("Existing inventory unit cost is invalid");
  return (
    (existingQuantity * existingUnitCost + receivedQuantity * receivedUnitCost) /
    (existingQuantity + receivedQuantity)
  );
}

export function inventoryPosting(
  movementType: string,
  signedQuantity: number,
  unitCost: number | null,
): InventoryPosting | null {
  if (!Number.isFinite(signedQuantity)) throw new Error("Stock movement quantity must be valid");
  if (unitCost == null) return null;
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Inventory unit cost must be valid");
  const amount = Math.round(Math.abs(signedQuantity) * unitCost * 100) / 100;
  if (amount === 0) return null;

  if (movementType === "RECEIPT")
    return { amount, debit: inventoryAccounts.inventory, credit: inventoryAccounts.goodsReceived };
  if (movementType === "OPENING_BALANCE")
    return { amount, debit: inventoryAccounts.inventory, credit: inventoryAccounts.openingEquity };
  if (movementType === "DISPENSE")
    return { amount, debit: inventoryAccounts.costOfGoodsSold, credit: inventoryAccounts.inventory };
  if (["ADJUSTMENT", "EMERGENCY_ADJUSTMENT", "STOCKTAKE_ADJUSTMENT"].includes(movementType)) {
    return signedQuantity > 0
      ? { amount, debit: inventoryAccounts.inventory, credit: inventoryAccounts.stockGain }
      : { amount, debit: inventoryAccounts.stockLoss, credit: inventoryAccounts.inventory };
  }
  return null;
}

export function stocktakeVariance(
  systemQuantity: number,
  countedQuantity: number,
  reason?: string | null,
) {
  if (![systemQuantity, countedQuantity].every(Number.isFinite) || countedQuantity < 0)
    throw new Error("Stocktake quantities are invalid");
  const variance = countedQuantity - systemQuantity;
  if (Math.abs(variance) > 0.000001 && (!reason || reason.trim().length < 5))
    throw new Error("Explain every stocktake variance with at least 5 characters");
  return Math.abs(variance) <= 0.000001 ? 0 : variance;
}

type Tx = Prisma.TransactionClient;

export async function assertStoresNotFrozen(
  tx: Tx,
  facilityId: string,
  storeIds: string[],
) {
  const uniqueStoreIds = [...new Set(storeIds)];
  const stocktake = await tx.stocktake.findFirst({
    where: {
      facilityId,
      storeId: { in: uniqueStoreIds },
      status: { in: ["OPEN", "SUBMITTED"] },
    },
    include: { store: { select: { name: true } } },
  });
  if (stocktake) {
    throw Object.assign(
      new Error(
        `${stocktake.store.name} is frozen for stocktake ${stocktake.stocktakeNumber}. Post or cancel that stocktake before moving stock.`,
      ),
      { status: 409 },
    );
  }
}

export async function postInventoryJournal(
  tx: Tx,
  input: {
    facilityId: string;
    postedById: string;
    sourceType: string;
    sourceId: string;
    description: string;
    movementType: string;
    signedQuantity: number;
    unitCost: number | null;
    catalogItemId?: string | null;
    batchId?: string | null;
    storeId?: string | null;
    occurredAt?: Date;
  },
) {
  const posting = inventoryPosting(input.movementType, input.signedQuantity, input.unitCost);
  if (!posting) return null;
  const dimension = {
    catalogItemId: input.catalogItemId || null,
    batchId: input.batchId || null,
    storeId: input.storeId || null,
  };
  return tx.accountingJournal.create({
    data: {
      facilityId: input.facilityId,
      entryNumber: `INV-${input.sourceId.toUpperCase()}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: input.description,
      postedById: input.postedById,
      occurredAt: input.occurredAt,
      lines: {
        create: [
          {
            ...dimension,
            accountCode: posting.debit.code,
            accountName: posting.debit.name,
            debit: new Prisma.Decimal(posting.amount),
          },
          {
            ...dimension,
            accountCode: posting.credit.code,
            accountName: posting.credit.name,
            credit: new Prisma.Decimal(posting.amount),
          },
        ],
      },
    },
  });
}
