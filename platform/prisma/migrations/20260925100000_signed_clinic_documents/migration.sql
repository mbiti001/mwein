-- CreateTable
CREATE TABLE "ClinicDocument" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "visitId" UUID,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "previousId" UUID,
    "correctionReason" TEXT,
    "payload" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "authorId" UUID NOT NULL,
    "signedById" UUID,
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signerRoles" TEXT[],
    "signerRegistration" TEXT,
    "signerSessionId" UUID,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicDocument_previousId_key" ON "ClinicDocument"("previousId");

-- CreateIndex
CREATE INDEX "ClinicDocument_facilityId_kind_createdAt_idx" ON "ClinicDocument"("facilityId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicDocument_facilityId_reference_key" ON "ClinicDocument"("facilityId", "reference");

-- AddForeignKey
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "ClinicDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_kind" CHECK ("kind" IN ('SICK','MATERNITY','DELIVERY','GATE'));
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_state" CHECK ("status" IN ('DRAFT','SIGNED') AND "version" > 0 AND "revision" > 0);
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_visit" CHECK (("kind" = 'DELIVERY' AND "visitId" IS NULL) OR ("kind" <> 'DELIVERY' AND "visitId" IS NOT NULL));
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_signature" CHECK (
  ("status" = 'DRAFT' AND "signedById" IS NULL AND "signedAt" IS NULL AND "contentHash" IS NULL) OR
  ("status" = 'SIGNED' AND "signedById" IS NOT NULL AND "signedAt" IS NOT NULL AND "signerName" IS NOT NULL AND "signerSessionId" IS NOT NULL AND "contentHash" IS NOT NULL AND "contentHash" ~ '^[a-f0-9]{64}$')
);
CREATE FUNCTION protect_signed_clinic_document() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed documents and document history are immutable; create a correction revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ClinicDocument_immutable" BEFORE UPDATE OR DELETE ON "ClinicDocument" FOR EACH ROW EXECUTE FUNCTION protect_signed_clinic_document();
