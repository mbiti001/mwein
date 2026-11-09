import { effectiveCatalogPrice, type CatalogPriceItemLike } from "./catalog-pricing";
export type OrderCharge = { currency: string; unitPrice: number | null; quantity: number; total: number | null; billedQuantity: number; billedTotal: number };
export function orderPriceSnapshot(item: CatalogPriceItemLike, at = new Date()) { const price = effectiveCatalogPrice(item, at); return { quotedUnitPrice: Number(price.unitPrice), quotedPriceVersionId: price.priceVersionId }; }
export function orderCharge(order: { quotedUnitPrice?: unknown; prescription?: { quantity: unknown } | null; invoiceItems?: { quantity: unknown; unitPrice: unknown }[] }): OrderCharge {
 const items = order.invoiceItems || []; const raw = order.quotedUnitPrice ?? items[0]?.unitPrice; const unitPrice = raw == null ? null : Number(raw); const quantity = Number(order.prescription?.quantity ?? items[0]?.quantity ?? 1);
 return { currency: "KES", unitPrice, quantity, total: unitPrice == null ? null : Number((unitPrice * quantity).toFixed(2)), billedQuantity: items.reduce((n,i) => n + Number(i.quantity), 0), billedTotal: Number(items.reduce((n,i) => n + Number(i.quantity) * Number(i.unitPrice), 0).toFixed(2)) };
}
export const chargeMoney = (value: number | null, currency = "KES") => value == null ? "Price not configured" : `${currency} ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
