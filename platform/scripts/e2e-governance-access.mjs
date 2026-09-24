import { randomUUID } from "node:crypto";

export async function verifyGovernanceAccess({ requestWithCookie: request, authenticate, pg, facility, patient, sessionCookie, otherFacilityId, adminPassword, steps }) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const mutation = (method, body) => ({ method, body: JSON.stringify(body) });
  const hr = await authenticate("MMS", "hr@example.test");
  const governor = await authenticate("MMS", "facility.admin@example.test");
  const staffList = await request("/api/admin/users", governor.cookie);
  for (const code of ["DATA_PROTECTION_OFFICER", "REPORTING_OFFICER"]) {
    assert(staffList.body.roles.some(role => role.code === code && role.assignable), `Governance cannot assign ${code}`);
    const deniedCreate = await request("/api/admin/users", hr.cookie, mutation("POST", { displayName: "Denied governance", email: "denied@example.test", roleCode: code, temporaryPassword: adminPassword }));
    assert(deniedCreate.response.status === 403, `HR could create ${code}`);
  }
  const created = await request("/api/admin/users", governor.cookie, mutation("POST", { displayName: "API DPO regression", email: "api.dpo@example.test", roleCode: "DATA_PROTECTION_OFFICER", temporaryPassword: adminPassword }));
  assert(created.response.status === 201 && !created.body.user.passwordHash, "Governance could not safely create DPO");
  const id = created.body.user.id;
  const dpo = await authenticate("MMS", "api.dpo@example.test");
  const changedPassword = await request("/api/auth/password", dpo.cookie, mutation("POST", { currentPassword: adminPassword, newPassword: "Synthetic-DPO-New-Password-2026!" }));
  assert(changedPassword.response.ok, "DPO could not replace temporary password");
  const privacy = await request(`/api/patients/${patient.id}/privacy`, dpo.cookie);
  assert(privacy.response.ok && privacy.response.headers.get("cache-control") === "private, no-store", "DPO privacy access or no-store protection failed");
  const hrList = await request("/api/admin/users", hr.cookie);
  assert(hrList.body.users.find(user => user.id === id)?.manageable === false, "HR UI marks DPO manageable");
  assert(hrList.body.roles.filter(role => ["DATA_PROTECTION_OFFICER", "REPORTING_OFFICER"].includes(role.code)).every(role => !role.assignable), "HR UI offers protected governance roles");
  for (const change of [{ status: "DISABLED" }, { temporaryPassword: adminPassword }, { roleCode: "RECEPTION" }]) {
    const denied = await request("/api/admin/users", hr.cookie, mutation("PATCH", { id, ...change }));
    assert(denied.response.status === 403, "HR could change an existing DPO account");
  }
  const foreign = (await pg.query(`SELECT "id" FROM "User" WHERE "facilityId"=$1 LIMIT 1`, [otherFacilityId])).rows[0];
  const deniedForeign = await request("/api/admin/users", governor.cookie, mutation("PATCH", { id: foreign.id, roleCode: "DATA_PROTECTION_OFFICER" }));
  assert(deniedForeign.response.status === 404, "Governance could change a foreign-facility user");
  const reassigned = await request("/api/admin/users", governor.cookie, mutation("PATCH", { id, roleCode: "RECEPTION" }));
  assert(reassigned.response.ok, "Governance could not change DPO role");
  const revoked = await request(`/api/patients/${patient.id}/privacy`, dpo.cookie);
  assert(revoked.response.status === 401 && revoked.response.headers.get("cache-control") === "private, no-store", "Role change failed to revoke DPO session");
  const restoreRole = await request("/api/admin/users", governor.cookie, mutation("PATCH", { id, roleCode: "DATA_PROTECTION_OFFICER" }));
  assert(restoreRole.response.ok, "Governance could not assign DPO to existing staff");
  const audit = (await pg.query(`SELECT "action", "sessionId", "facilityId" FROM "AuditEvent" WHERE "entityId"=$1`, [id])).rows;
  assert(audit.some(event => event.action === "STAFF_CREATED") && audit.some(event => event.action === "STAFF_ACCESS_UPDATED"), "DPO management audit missing");
  assert(audit.every(event => event.sessionId && event.facilityId === facility.id), "DPO audit omitted facility/session");
  steps.push("verify DPO onboarding, governance restrictions, tenant boundaries and session revocation");

  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  const paths = [`/api/reports/operations?from=${date}&to=${date}`, `/api/reports/moh-monthly?month=${date.slice(0,7)}`];
  for (const email of ["billing@example.test", "clinician.cover@example.test", "system.only@example.test"]) {
    const actor = await authenticate("MMS", email);
    for (const path of paths) {
      const denied = await request(path, actor.cookie);
      assert(denied.response.status === 403 && denied.response.headers.get("cache-control") === "private, no-store", `${email} accessed facility reports`);
    }
    if (email !== "system.only@example.test") assert(actor.body.user.permissions.includes("billing.read") && actor.body.user.permissions.includes("billing.write"), "Report restriction removed billing access");
  }
  const reporter = await authenticate("MMS", "reports@example.test");
  for (const path of paths) {
    const report = await request(path, reporter.cookie);
    assert(report.response.ok && report.response.headers.get("cache-control") === "private, no-store", "Reporting officer could not access uncached report");
  }
  const otherReporterId = randomUUID();
  await pg.query(`INSERT INTO "User" ("id","facilityId","email","displayName","passwordHash","mustChangePassword","updatedAt") SELECT $1,$2,'reports@example.test','Other reporting officer',"passwordHash",false,now() FROM "User" WHERE "email"='admin@mwein.local' AND "facilityId"=$3`, [otherReporterId, otherFacilityId, facility.id]);
  await pg.query(`INSERT INTO "UserRole" ("userId","roleId") SELECT $1,"id" FROM "Role" WHERE "code"='REPORTING_OFFICER'`, [otherReporterId]);
  const otherReporter = await authenticate("OTHER", "reports@example.test");
  for (const path of paths) {
    const report = await request(path, otherReporter.cookie);
    assert(report.response.ok && (report.body.summary?.visits ?? report.body.services?.visits) === 0, "Reporting crossed the facility boundary");
  }
  const exported = await request("/api/admin/audit/export", sessionCookie);
  const events = exported.body.events.filter(event => event.action === "REPORT_ACCESSED");
  for (const context of ["OPERATIONS", "MONTHLY_CLINICAL"]) assert(events.some(event => JSON.parse(event.reason).context === context), `Missing report audit: ${context}`);
  assert(events.every(event => event.sessionId && event.facilityId === facility.id && /^[a-f0-9]{64}$/.test(event.afterHash)), "Report audit attribution or fingerprint missing");
  steps.push("verify explicit reporting authorization, unchanged billing access, facility isolation and report audit");
}
