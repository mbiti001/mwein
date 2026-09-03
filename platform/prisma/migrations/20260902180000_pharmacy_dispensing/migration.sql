ALTER TABLE "Prescription"
ADD COLUMN "dispensedQuantity" DECIMAL(12,3),
ADD COLUMN "dispenseStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "dispenseNotes" TEXT,
ADD COLUMN "dispensedAt" TIMESTAMP(3),
ADD COLUMN "dispensedById" UUID;

ALTER TABLE "Prescription"
ADD CONSTRAINT "Prescription_dispensedById_fkey"
FOREIGN KEY ("dispensedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
