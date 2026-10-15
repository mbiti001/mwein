-- Legacy states remain intact; evidence is never fabricated or backfilled.
ALTER TABLE "DataSubjectRequest" ADD COLUMN "identityVerification" JSONB;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_identity_evidence_check" CHECK (
 "identityVerification" IS NULL OR COALESCE((
 jsonb_typeof("identityVerification") = 'object'
 AND "identityVerification"->>'version' = '1'
 AND "identityVerification"->>'requestId' = "id"::text
 AND "identityVerification"->>'patientId' = "patientId"::text
 AND "identityVerification"->>'facilityId' = "facilityId"::text
 AND "identityVerification"->>'requestType' = "type"
 AND "identityVerification"->>'requesterKind' IN ('PATIENT','AUTHORIZED_REPRESENTATIVE')
 AND "identityVerification"->>'authorizationScope' IN ('REQUEST_REVIEW_ONLY','PATIENT_RECORD_EXPORT')
 AND "identityVerification"->>'attested' = 'true'
 AND length(trim("identityVerification"->>'requesterReference')) >= 3
 AND length(trim("identityVerification"->>'identityEvidenceReference')) >= 3
 AND length(trim("identityVerification"->>'scopeSummary')) >= 10
 AND length("identityVerification"->>'verifiedById') > 0
 AND length("identityVerification"->>'verifiedByName') > 0
 AND length("identityVerification"->>'verifiedAt') > 0
 AND length("identityVerification"->>'requestKey') > 0
 AND ("identityVerification"->>'requesterKind' = 'PATIENT' OR
      (length(trim("identityVerification"->>'relationship')) >= 3 AND length(trim("identityVerification"->>'authorityEvidenceReference')) >= 3))
 ), false));
CREATE FUNCTION protect_rights_identity_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."identityVerification" IS NOT NULL AND (TG_OP = 'DELETE' OR
   ROW(NEW."identityVerification", NEW."id", NEW."facilityId", NEW."patientId", NEW."type", NEW."details", NEW."requestedAt", NEW."dueAt")
   IS DISTINCT FROM ROW(OLD."identityVerification", OLD."id", OLD."facilityId", OLD."patientId", OLD."type", OLD."details", OLD."requestedAt", OLD."dueAt")) THEN
   RAISE EXCEPTION 'Verified rights identity, scope and original request are immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER rights_identity_evidence_immutable BEFORE UPDATE OR DELETE ON "DataSubjectRequest"
FOR EACH ROW EXECUTE FUNCTION protect_rights_identity_evidence();
