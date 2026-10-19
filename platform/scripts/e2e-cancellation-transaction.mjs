// Runs only inside the guarded, disposable outpatient test database.
// Injected SQL failures establish rollback/retry behavior, not contention capacity.
export async function verifyCancellationTransaction({ pg, visitId, actorId, facilityId, request, assert, steps }) {
  const state = async () => (await pg.query(`SELECT v."status", i."status" AS invoice,
    (SELECT json_agg(q."status" ORDER BY q.id) FROM "QueueEntry" q WHERE q."visitId"=v.id) AS queues,
    (SELECT count(*)::int FROM "VisitCancellation" c WHERE c."visitId"=v.id) AS cancellations,
    (SELECT count(*)::int FROM "AuditEvent" a WHERE a."entityId"=v.id::text AND a.action='VISIT_CANCELLED') AS audits
    FROM "Visit" v JOIN "Invoice" i ON i."visitId"=v.id WHERE v.id=$1`, [visitId])).rows[0];
  const before = await state();
  await pg.exec(`CREATE SEQUENCE e2e_cancel_attempt;
    CREATE FUNCTION e2e_cancel_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='VISIT_CANCELLED' THEN PERFORM nextval('e2e_cancel_attempt'); RAISE EXCEPTION 'synthetic cancellation audit failure' USING ERRCODE='P0001'; END IF;
      RETURN NEW; END; $$;
    CREATE TRIGGER e2e_cancel_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_cancel_failure();`);
  try {
    const failed = await request();
    assert(failed.response.status === 500, "Cancellation hid a nonretryable audit failure");
    assert(JSON.stringify(await state()) === JSON.stringify(before), "Audit failure did not roll back cancellation, invoice, queue and audit state");
    assert(Number((await pg.query('SELECT last_value FROM e2e_cancel_attempt')).rows[0].last_value) === 1, "Nonretryable audit failure was replayed");
    steps.push("verify cancellation audit failure rolls back all saved state without retry");
    await pg.exec(`CREATE OR REPLACE FUNCTION e2e_cancel_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='VISIT_CANCELLED' AND nextval('e2e_cancel_attempt')=2 THEN RAISE EXCEPTION 'synthetic known-aborted cancellation' USING ERRCODE='40001'; END IF;
      RETURN NEW; END; $$;`);
    const saved = await request();
    assert(saved.response.status === 200, "Cancellation did not recover from an injected SQL serialization abort");
    assert(Number((await pg.query('SELECT last_value FROM e2e_cancel_attempt')).rows[0].last_value) === 3, "Cancellation did not execute exactly one SQL retry");
    const after = await state();
    assert(after.status === 'CANCELLED' && after.invoice === 'VOID' && after.queues.every(status => status === 'CANCELLED'), "Retried cancellation did not persist terminal states");
    assert(after.cancellations === 1 && after.audits === 1, "Retried cancellation duplicated its record or audit");
    const attribution = (await pg.query(`SELECT c."cancelledById", c."facilityId", a."userId", a."sessionId"
      FROM "VisitCancellation" c JOIN "AuditEvent" a ON a."entityId"=c."visitId"::text AND a.action='VISIT_CANCELLED'
      WHERE c."visitId"=$1 AND a."facilityId"=$2`, [visitId, facilityId])).rows[0];
    assert(attribution?.cancelledById === actorId && attribution.facilityId === facilityId && attribution.userId === actorId && attribution.sessionId, "Retried cancellation lost actor, facility or session attribution");
    const repeated = await request();
    assert(repeated.response.status === 409 && (await state()).audits === 1, "A repeated terminal cancellation changed the existing record");
    steps.push("verify SQL-aborted cancellation retries once with single attributed record and terminal replay denial");
  } finally {
    await pg.exec('DROP TRIGGER e2e_cancel_failure ON "AuditEvent"; DROP FUNCTION e2e_cancel_failure(); DROP SEQUENCE e2e_cancel_attempt;');
  }
}
