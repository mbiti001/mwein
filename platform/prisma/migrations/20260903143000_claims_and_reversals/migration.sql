CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID','CANCELLED');
ALTER TABLE "Payment" ADD COLUMN "reversedAt" TIMESTAMP(3), ADD COLUMN "reversalReason" TEXT, ADD COLUMN "reversedById" UUID;
CREATE TABLE "Claim" ("id" UUID NOT NULL,"invoiceId" UUID NOT NULL,"createdById" UUID NOT NULL,"payer" TEXT NOT NULL,"memberNumber" TEXT NOT NULL,"claimNumber" TEXT NOT NULL,"amount" DECIMAL(14,2) NOT NULL,"status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',"notes" TEXT,"submittedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "Claim_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "Claim_claimNumber_key" ON "Claim"("claimNumber");CREATE INDEX "Claim_invoiceId_status_idx" ON "Claim"("invoiceId","status");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
