-- Preserve existing check-in amounts as editable facility catalogue baselines.
INSERT INTO "CatalogItem" ("id", "facilityId", "category", "code", "name", "unitPrice", "currency", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), f."id", 'PROCEDURE', 'CONSULT-' || upper(c.clinic), c.clinic || ' consultation',
       CASE WHEN c.clinic = 'Emergency' THEN 0 ELSE 500 END, 'KES', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Facility" f CROSS JOIN (VALUES ('Outpatient'), ('ANC'), ('MCH / PNC'), ('Diabetes'), ('Dialysis'), ('Cancer care'), ('Sickle-cell care'), ('Walk-in'), ('HTN'), ('Paediatrics'), ('Emergency'), ('Other'), ('DM')) AS c(clinic)
ON CONFLICT ("facilityId", "code") DO NOTHING;

INSERT INTO "CatalogPriceVersion" ("id", "facilityId", "catalogItemId", "unitPrice", "currency", "effectiveFrom", "reason")
SELECT gen_random_uuid(), i."facilityId", i."id", i."unitPrice", i."currency", i."createdAt", 'Existing consultation charge moved to governed catalogue'
FROM "CatalogItem" i WHERE i."code" LIKE 'CONSULT-%'
AND NOT EXISTS (SELECT 1 FROM "CatalogPriceVersion" p WHERE p."catalogItemId" = i."id");
