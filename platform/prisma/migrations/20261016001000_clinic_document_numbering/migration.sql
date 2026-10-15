-- Existing signed references and fingerprints remain unchanged.
ALTER TABLE "ClinicDocument" ADD COLUMN "creationKey" UUID;
ALTER TABLE "ClinicDocument" ADD COLUMN "creationHash" TEXT;
ALTER TABLE "ClinicDocument" ADD CONSTRAINT "ClinicDocument_creation_receipt_check"
CHECK (("creationKey" IS NULL AND "creationHash" IS NULL) OR
       ("creationKey" IS NOT NULL AND "creationHash" IS NOT NULL AND "creationHash" ~ '^[a-f0-9]{64}$'));
CREATE UNIQUE INDEX "ClinicDocument_facilityId_creationKey_key" ON "ClinicDocument"("facilityId", "creationKey");

-- A draft may be edited, but its allocated reference and retry receipt cannot be reassigned.
CREATE FUNCTION protect_clinic_document_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."facilityId", NEW."kind", NEW."reference", NEW."authorId", NEW."creationKey", NEW."creationHash")
     IS DISTINCT FROM ROW(OLD."id", OLD."facilityId", OLD."kind", OLD."reference", OLD."authorId", OLD."creationKey", OLD."creationHash") THEN
    RAISE EXCEPTION 'Clinic document identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinic_document_identity_immutable BEFORE UPDATE ON "ClinicDocument"
FOR EACH ROW EXECUTE FUNCTION protect_clinic_document_identity();

ALTER TABLE "PurchaseOrder" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_request_hash_check"
CHECK ("requestHash" IS NULL OR ("idempotencyKey" IS NOT NULL AND "requestHash" ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION protect_purchase_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."facilityId", NEW."orderNumber", NEW."idempotencyKey", NEW."requestHash", NEW."createdById")
     IS DISTINCT FROM ROW(OLD."facilityId", OLD."orderNumber", OLD."idempotencyKey", OLD."requestHash", OLD."createdById") THEN
    RAISE EXCEPTION 'Purchase order identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_identity_immutable BEFORE UPDATE ON "PurchaseOrder"
FOR EACH ROW EXECUTE FUNCTION protect_purchase_order_identity();
