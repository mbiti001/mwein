CREATE TABLE "ClaimLine" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "invoiceItemId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClaimLine_claimId_invoiceItemId_key" ON "ClaimLine"("claimId", "invoiceItemId");
CREATE INDEX "ClaimLine_invoiceItemId_idx" ON "ClaimLine"("invoiceItemId");
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
