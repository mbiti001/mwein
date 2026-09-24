-- A medication order may be supplied in multiple events. Each event needs its own
-- invoice line so historic prices and substitutions are never rewritten.
DROP INDEX IF EXISTS "InvoiceItem_orderId_key";
CREATE INDEX "InvoiceItem_orderId_idx" ON "InvoiceItem"("orderId");
