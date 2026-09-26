CREATE TABLE "PaymentRequest" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "key" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "externalKey" TEXT,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentRequest_facilityId_key_key" ON "PaymentRequest"("facilityId", "key");
CREATE UNIQUE INDEX "PaymentRequest_facilityId_externalKey_key" ON "PaymentRequest"("facilityId", "externalKey");
CREATE INDEX "PaymentRequest_invoiceId_idx" ON "PaymentRequest"("invoiceId");
