-- Frontline staff need the same governed cancellation workflow as reception.
-- The API still checks clinical work, financial commitments, reason and audit.
INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid(), 'visit.cancel', 'Cancel visits with a documented reason')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
WHERE role."code" IN ('NURSE', 'CLINICIAN', 'CLINICIAN_COVER', 'MEDICAL_DIRECTOR')
  AND permission."code" = 'visit.cancel'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
