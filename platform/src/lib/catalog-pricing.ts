type MoneyValue = number | string | { toString(): string };

export type CatalogPriceVersionLike = {
  id: string;
  unitPrice: MoneyValue;
  costPrice?: MoneyValue | null;
  effectiveFrom: Date | string;
};

export type CatalogPriceItemLike = {
  unitPrice: MoneyValue;
  costPrice?: MoneyValue | null;
  priceVersions?: CatalogPriceVersionLike[];
};

const timestamp = (value: Date | string) => new Date(value).getTime();

export function effectiveCatalogPrice(item: CatalogPriceItemLike, at = new Date()) {
  const selected = (item.priceVersions || [])
    .filter((version) => timestamp(version.effectiveFrom) <= at.getTime())
    .sort((left, right) => timestamp(right.effectiveFrom) - timestamp(left.effectiveFrom))[0];
  return {
    unitPrice: selected?.unitPrice ?? item.unitPrice,
    costPrice: selected ? selected.costPrice ?? null : item.costPrice ?? null,
    priceVersionId: selected?.id ?? null,
    effectiveFrom: selected ? new Date(selected.effectiveFrom) : null,
  };
}

export function nextCatalogPrice(item: CatalogPriceItemLike, at = new Date()) {
  const selected = (item.priceVersions || [])
    .filter((version) => timestamp(version.effectiveFrom) > at.getTime())
    .sort((left, right) => timestamp(left.effectiveFrom) - timestamp(right.effectiveFrom))[0];
  return selected
    ? {
        id: selected.id,
        unitPrice: selected.unitPrice,
        costPrice: selected.costPrice ?? null,
        effectiveFrom: new Date(selected.effectiveFrom),
      }
    : null;
}

export function kenyaEffectiveDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid price effective date");
  const parsed = new Date(`${value}T00:00:00+03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Use a valid price effective date");
  return parsed;
}

export function nairobiDateInputValue(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
