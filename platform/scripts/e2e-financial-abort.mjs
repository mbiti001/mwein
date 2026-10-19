import { createHash } from "node:crypto";

// Only called from the guarded, freshly empty synthetic outpatient database.
// Snapshot all affected tables: failed writes and audit-head changes must roll back.
const tables = ["Invoice", "InvoiceItem", "Payment", "Receipt", "PaymentRequest", "ReferenceSequence",
  "Visit", "QueueEntry", "ClinicalOrder", "Prescription", "Dispensation", "DispensationItem",
  "InventoryBatch", "InventoryLocationBalance", "StockMovement", "AccountingJournal", "AccountingJournalLine",
  "AuditEvent", "AuditChainHead"];

export async function verifyFinancialAbort({ pg, databaseKind, action, facilityId, actorId, entityId, request, successStatus, assert, steps }) {
  if (!["PAYMENT_RECEIVED", "MEDICATION_DISPENSED"].includes(action)) throw new Error("Unsupported synthetic abort action");
  const snapshot = async () => {
    const state = {};
    for (const table of tables) state[table] = (await pg.query(`SELECT * FROM "${table}" ORDER BY ${table === "AuditChainHead" ? '"facilityId"' : 'id'}`)).rows;
    return state;
  };
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const before = await snapshot();
  await pg.exec(`CREATE SEQUENCE e2e_financial_attempt;
    CREATE FUNCTION e2e_financial_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='${action}' THEN PERFORM nextval('e2e_financial_attempt'); RAISE EXCEPTION 'synthetic financial audit rejection' USING ERRCODE='P0001'; END IF;
      RETURN NEW; END; $$;
    CREATE TRIGGER e2e_financial_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_financial_failure();`);
  let result, observedRawLock = false;
  try {
    const rejected = await request();
    assert(rejected.response.status === 500, `${action}: nonretryable audit rejection was hidden`);
    assert(Number((await pg.query('SELECT last_value FROM e2e_financial_attempt')).rows[0].last_value) === 1, `${action}: nonretryable rejection was retried`);
    assert(digest(await snapshot()) === digest(before), `${action}: rejected transaction left changed durable state`);
    steps.push(`verify ${action} audit rejection rolls back all 19 affected tables without retry`);
    await pg.exec('DROP TRIGGER e2e_financial_failure ON "AuditEvent";');

    if (databaseKind === "native-postgresql") {
      // Hold the real audit-head row until the application's raw SELECT FOR UPDATE
      // waits on it. A committed version change then forces SQLSTATE 40001 at that
      // raw statement, exercising the P2010 branch rather than a modeled error.
      await pg.exec('BEGIN');
      let pending;
      try {
        await pg.query('SELECT * FROM "AuditChainHead" WHERE "facilityId"=$1 FOR UPDATE', [facilityId]);
        pending = request();
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          // PostgreSQL caches activity snapshots within our blocking transaction.
          await pg.query('SELECT pg_stat_clear_snapshot()');
          const waiting = (await pg.query(`SELECT query FROM pg_stat_activity
            WHERE datname=current_database() AND pid<>pg_backend_pid()
            AND wait_event_type='Lock' AND query LIKE '%FROM "AuditChainHead"%' AND query LIKE '%FOR UPDATE%'`)).rows;
          if (waiting.some(row => row.query.includes('"chainVersion"') && row.query.includes('"eventHash"'))) { observedRawLock = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert(observedRawLock, `${action}: raw audit lock was not observed; no contention proof`);
        await pg.query('UPDATE "AuditChainHead" SET "updatedAt"="updatedAt" WHERE "facilityId"=$1', [facilityId]);
        await pg.exec('COMMIT');
        result = await pending;
      } catch (error) {
        await pg.exec('ROLLBACK');
        if (pending) await pending; // Settle the request before cleanup, never replay it here.
        throw error;
      }
    } else {
      // PGlite's single application connection cannot establish native lock contention.
      // Retain its default fixture support with explicitly injected SQL rollback only.
      await pg.exec(`CREATE OR REPLACE FUNCTION e2e_financial_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='${action}' AND nextval('e2e_financial_attempt')=2 THEN RAISE EXCEPTION 'synthetic financial abort' USING ERRCODE='40001'; END IF;
        RETURN NEW; END; $$;
        CREATE TRIGGER e2e_financial_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION e2e_financial_failure();`);
      result = await request();
      assert(Number((await pg.query('SELECT last_value FROM e2e_financial_attempt')).rows[0].last_value) === 3, `${action}: expected exactly one injected retry`);
    }
    assert(result.response.status === successStatus, `${action}: aborted transaction did not recover (${result.response.status})`);
    const after = await snapshot();
    const newRows = table => after[table].filter(row => !before[table].some(old => old.id === row.id));
    const audit = newRows("AuditEvent").filter(row => row.action === action && row.entityId === entityId);
    assert(audit.length === 1 && audit[0].userId === actorId && audit[0].facilityId === facilityId, `${action}: missing or duplicate attributed success audit`);
    if (action === "PAYMENT_RECEIVED") {
      for (const table of ["Payment", "Receipt", "PaymentRequest"]) assert(newRows(table).length === 1, `${action}: duplicate or missing ${table}`);
      const payment = newRows("Payment")[0], receipt = newRows("Receipt")[0], replay = newRows("PaymentRequest")[0];
      assert(payment.invoiceId === entityId && payment.receivedById === actorId && receipt.paymentId === payment.id && replay.invoiceId === entityId && replay.facilityId === facilityId && replay.response.payment.id === payment.id, "Payment, receipt and replay linkage differ");
      const sequence = after.ReferenceSequence.find(row => row.facilityId === facilityId && row.kind === "RECEIPT" && row.year === new Date().getFullYear());
      const old = before.ReferenceSequence.find(row => row.id === sequence?.id);
      assert(sequence && BigInt(sequence.nextValue) === (old ? BigInt(old.nextValue) : 1n) + 1n, "Receipt sequence advanced more than once");
    } else {
      for (const table of ["Dispensation", "DispensationItem", "StockMovement", "AccountingJournal", "InvoiceItem"]) assert(newRows(table).length === 1, `${action}: duplicate or missing ${table}`);
      const supply = newRows("Dispensation")[0], movement = newRows("StockMovement")[0], journal = newRows("AccountingJournal")[0];
      assert(supply.dispensedById === actorId && movement.dispensationId === supply.id && journal.sourceId === movement.id && journal.facilityId === facilityId, "Stock and accounting source linkage differ");
      const lines = newRows("AccountingJournalLine");
      assert(lines.length === 2 && lines.every(line => line.journalId === journal.id) && lines.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0) === 0, "Retried stock journal is duplicated or unbalanced");
      for (const table of ["InventoryBatch", "InventoryLocationBalance"]) {
        const field = table === "InventoryBatch" ? "quantityAvailable" : "quantity";
        const old = before[table].find(row => table === "InventoryBatch" ? row.id === movement.batchId : row.batchId === movement.batchId && row.storeId === movement.sourceStoreId);
        const current = after[table].find(row => row.id === old?.id);
        assert(old && current && Number(old[field]) - Number(current[field]) === Number(supply.quantity), `${table}: retry changed stock more than once`);
      }
      const receipt = newRows("AuditEvent").filter(row => row.action === "DISPENSING_REQUEST_RECORDED" && row.entityId === supply.id);
      assert(receipt.length === 1 && receipt[0].sessionId && receipt[0].userId === actorId && receipt[0].facilityId === facilityId, "Retried dispensing lost its request attribution");
    }
    console.log(JSON.stringify({ event: "financial_abort_evidence", action, databaseKind, observedRawLock,
      rollbackTables: tables.length, beforeSha256: digest(before), afterSha256: digest(after),
      successStatus: result.response.status, successAuditCount: audit.length,
      // Existing business success audits omit sessionId; request receipt retains it for dispensing.
      businessAuditSessionIdPresent: Boolean(audit[0].sessionId),
      newRowCounts: Object.fromEntries(tables.filter(table => table !== "AuditChainHead").map(table => [table, newRows(table).length])) }));
    steps.push(`verify ${action} ${observedRawLock ? "native raw-lock abort" : "injected abort"} recovers with single durable effects`);
    return result;
  } finally {
    await pg.exec('DROP TRIGGER IF EXISTS e2e_financial_failure ON "AuditEvent"; DROP FUNCTION e2e_financial_failure(); DROP SEQUENCE e2e_financial_attempt;');
  }
}
