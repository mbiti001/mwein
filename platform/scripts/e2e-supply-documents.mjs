import { randomUUID } from "node:crypto";

export async function verifySupplyDocuments({ pg, api, requestWithCookie, authenticate, sessionCookie, facility, medicine, storeId, otherFacilityId, assert, steps }) {
  const post = body => ({ method: "POST", body: JSON.stringify(body) });
  const supplier = (await api("create supplier for document verification", "/api/supply", post({ action: "SUPPLIER", code: "DOC-TEST", name: "Synthetic Medical Supplies", email: "supplier@example.test" }))).body.result;
  const orderInput = { action: "PURCHASE_ORDER", idempotencyKey: randomUUID(), supplierId: supplier.id, catalogItemId: medicine.id, quantity: 3, unitCost: 3.35, notes: "Synthetic purchase order for document verification" };
  const concurrentOrders = await Promise.all([0,1].map(() => requestWithCookie("/api/supply", sessionCookie, post(orderInput))));
  assert(concurrentOrders.map(r=>r.response.status).sort().join(',') === '200,201', "Concurrent order retries did not resolve to one document");
  const order = concurrentOrders.find(r=>r.response.status===201).body.result;
  assert(/^.+-PO-\d{4}-\d{6,}$/.test(order.orderNumber) && concurrentOrders.every(r=>r.body.result.orderNumber===order.orderNumber), "Purchase order numbering or replay reference changed");
  assert((await requestWithCookie("/api/supply", sessionCookie, post({ ...orderInput, quantity:4 }))).response.status===409, "Order replay accepted different contents");
  steps.push("verify numbered purchase-order concurrent retry and changed-payload rejection");
  const orderCounter = JSON.stringify((await pg.query(`SELECT "nextValue"::text FROM "ReferenceSequence" WHERE "facilityId"=$1 AND "kind"='PURCHASE_ORDER' ORDER BY "year"`, [facility.id])).rows);
  const failedOrderKey = randomUUID();
  await pg.exec(`CREATE FUNCTION reject_order_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='PURCHASE_ORDER_DRAFTED' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER order_audit_test BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_order_audit_test();`);
  try {
    const failure = await requestWithCookie("/api/supply", sessionCookie, post({ ...orderInput, idempotencyKey: failedOrderKey }));
    assert(failure.response.status === 500, "Failed order audit did not reject allocation");
    assert(JSON.stringify((await pg.query(`SELECT "nextValue"::text FROM "ReferenceSequence" WHERE "facilityId"=$1 AND "kind"='PURCHASE_ORDER' ORDER BY "year"`, [facility.id])).rows) === orderCounter, "Failed order audit consumed a serial");
    assert(Number((await pg.query('SELECT COUNT(*) FROM "PurchaseOrder" WHERE "idempotencyKey"=$1', [failedOrderKey])).rows[0].count) === 0, "Failed order audit retained a document");
  } finally { await pg.exec('DROP TRIGGER order_audit_test ON "AuditEvent"; DROP FUNCTION reject_order_audit_test();'); }
  for (const statement of ['UPDATE "PurchaseOrder" SET "orderNumber"=\'renumbered\' WHERE "id"=$1', 'UPDATE "PurchaseOrder" SET "requestHash"=NULL WHERE "id"=$1']) {
    let rejected = false; try { await pg.query(statement, [order.id]); } catch (error) { rejected = /immutable/.test(error.message); }
    assert(rejected, "Purchase order identity could be reassigned");
  }
  steps.push("verify purchase-order counter rollback and immutable reference/receipt");
  // Exercise existing multi-line database orders even though the current entry form creates one line.
  const secondLineId = randomUUID();
  await pg.query('INSERT INTO "PurchaseOrderLine" ("id","purchaseOrderId","catalogItemId","quantityOrdered","unitCost") VALUES ($1,$2,$3,0.3,0.15)', [secondLineId, order.id, medicine.id]);
  const draft = await api("preview draft purchase order", "/api/supply/documents", post({ kind: "PURCHASE_ORDER", id: order.id, intent: "PREVIEW" }));
  assert(draft.body.document.status === "DRAFT" && draft.body.document.total === "10.10", "Draft document lost its status or decimal line totals");
  const expiryDate = new Date(Date.now() + 730 * 86400000).toISOString().slice(0, 10);
  const receiptInput = { action: "RECEIVE", idempotencyKey: randomUUID(), lineId: order.lines[0].id, storeId, batchNumber: "DOC-DELIVERY-1", expiryDate, quantity: 1 };
  const unapproved = await requestWithCookie("/api/supply", sessionCookie, post(receiptInput));
  assert(unapproved.response.status === 422, "Unapproved order accepted a stock receipt");
  await api("submit document purchase order", "/api/supply", post({ action: "SUBMIT_PURCHASE_ORDER", purchaseOrderId: order.id }));
  const selfApproval = await requestWithCookie("/api/supply", sessionCookie, post({ action: "APPROVE_PURCHASE_ORDER", purchaseOrderId: order.id }));
  assert(selfApproval.response.status === 403, "Order creator could approve their own document");
  const checker = await authenticate("MMS", "pharmacy@example.test");
  const approved = await requestWithCookie("/api/supply", checker.cookie, post({ action: "APPROVE_PURCHASE_ORDER", purchaseOrderId: order.id }));
  assert(approved.response.ok, "Independent order approval failed");
  steps.push("verify independent purchase-order approval before receiving stock");

  // Fail receipt retention to prove the transaction cannot leave stock without its evidence.
  const receiptCounter = JSON.stringify((await pg.query(`SELECT "nextValue"::text FROM "ReferenceSequence" WHERE "facilityId"=$1 AND "kind"='GOODS_RECEIPT' ORDER BY "year"`, [facility.id])).rows);
  await pg.exec(`CREATE FUNCTION e2e_reject_receipt() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt retention failure'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER e2e_reject_receipt BEFORE INSERT ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION e2e_reject_receipt();`);
  try {
    const failed = await requestWithCookie("/api/supply", sessionCookie, post(receiptInput));
    assert(failed.response.status === 500, "Synthetic receipt failure did not stop the transaction");
    const rolledBack = (await pg.query('SELECT "quantityReceived"::text AS quantity FROM "PurchaseOrderLine" WHERE "id"=$1', [receiptInput.lineId])).rows[0];
    const batches = (await pg.query('SELECT COUNT(*)::int AS count FROM "InventoryBatch" WHERE "batchNumber"=$1', [receiptInput.batchNumber])).rows[0];
    assert(Number(rolledBack.quantity) === 0 && batches.count === 0, "Receipt retention failure committed partial stock changes");
    assert(JSON.stringify((await pg.query(`SELECT "nextValue"::text FROM "ReferenceSequence" WHERE "facilityId"=$1 AND "kind"='GOODS_RECEIPT' ORDER BY "year"`, [facility.id])).rows) === receiptCounter, "Failed receipt retention consumed its serial");
  } finally {
    await pg.exec('DROP TRIGGER e2e_reject_receipt ON "GoodsReceipt"; DROP FUNCTION e2e_reject_receipt();');
  }
  steps.push("verify receipt retention failure rolls back inventory and order updates");
  const concurrentReceipts = await Promise.all([0,1].map(() => requestWithCookie("/api/supply", sessionCookie, post(receiptInput))));
  assert(concurrentReceipts.map(r=>r.response.status).sort().join(',') === '200,201', "Concurrent receipt retries did not resolve to one document");
  const first = concurrentReceipts.find(r=>r.response.status===201).body.result;
  assert(first.goodsReceiptId && /^.+-GRN-\d{4}-\d{6,}$/.test(first.receiptNumber) && concurrentReceipts.every(r=>r.body.result.receiptNumber===first.receiptNumber), "Receipt response omitted or changed its printable serial");
  steps.push("verify numbered goods-receipt concurrent retry without duplicate stock");
  const preview = (await api("preview retained goods receipt", "/api/supply/documents", post({ kind: "GOODS_RECEIPT", id: first.goodsReceiptId, intent: "PREVIEW" }))).body.document;
  assert(preview.lines[0].quantity === "1" && preview.lines[0].unitCost === "3.35" && preview.total === "3.35" && preview.actors[0].name === "Mwein System Administrator", "Receipt failed to retain original quantity, value or receiver");
  const replay = await requestWithCookie("/api/supply", sessionCookie, post(receiptInput));
  assert(replay.response.ok && replay.body.replayed && replay.body.result.goodsReceiptId === first.goodsReceiptId, "Receipt retry failed to identify the original document");
  const changedReplay = await requestWithCookie("/api/supply", sessionCookie, post({ ...receiptInput, quantity: 2 }));
  const otherActorReplay = await requestWithCookie("/api/supply", checker.cookie, post(receiptInput));
  assert(changedReplay.response.status === 409 && otherActorReplay.response.status === 409, "Receipt key accepted changed contents or a different actor");
  const precision = await requestWithCookie("/api/supply", sessionCookie, post({ ...receiptInput, idempotencyKey: randomUUID(), quantity: 0.0001 }));
  assert(precision.response.status === 422, "Receipt accepted quantities beyond ledger precision");
  const overReceipt = await requestWithCookie("/api/supply", sessionCookie, post({ ...receiptInput, idempotencyKey: randomUUID(), quantity: 3 }));
  assert(overReceipt.response.status === 422, "Receipt exceeded the outstanding quantity");
  steps.push("verify receipt replay, actor isolation, precision and over-receipt controls");

  await api("complete first item without closing the remaining order line", "/api/supply", post({ ...receiptInput, idempotencyKey: randomUUID(), quantity: 2 }));
  const partial = (await api("verify multi-line order remains partially received", "/api/supply/documents", post({ kind: "PURCHASE_ORDER", id: order.id, intent: "PREVIEW" }))).body.document;
  assert(partial.status === "PARTIALLY_RECEIVED", "One completed item prematurely closed a multi-line order");
  await pg.query('UPDATE "PurchaseOrderLine" SET "unitCost"=NULL WHERE "id"=$1', [secondLineId]);
  const secondInput = { ...receiptInput, idempotencyKey: randomUUID(), lineId: secondLineId, batchNumber: "DOC-FRACTIONAL", quantity: 0.3 };
  const unvalued = await requestWithCookie("/api/supply", sessionCookie, post(secondInput));
  assert(unvalued.response.status === 422, "Legacy unpriced order received stock without a valuation");
  await pg.query('UPDATE "PurchaseOrderLine" SET "unitCost"=0.15 WHERE "id"=$1', [secondLineId]);
  const last = (await api("receive final fractional order line", "/api/supply", post(secondInput))).body.result;
  const completed = (await api("verify completed purchase order document", "/api/supply/documents", post({ kind: "PURCHASE_ORDER", id: order.id, intent: "PRINT" }))).body.document;
  assert(completed.status === "RECEIVED" && completed.actors.some(actor => actor.label === "Approved by" && actor.name === "MMS pharmacy manager"), "Completed document lost approval evidence");
  const ledger = (await pg.query(`SELECT r."snapshot"->>'total' AS total, m."quantity"::text AS quantity,
    (SELECT SUM(l."debit")::text FROM "AccountingJournalLine" l WHERE l."journalId"=j."id") AS debit
    FROM "GoodsReceipt" r JOIN "StockMovement" m ON m."id"=r."movementId"
    JOIN "AccountingJournal" j ON j."sourceId"=m."id"::text AND j."sourceType"='STOCK_MOVEMENT' WHERE r."id"=$1`, [last.goodsReceiptId])).rows[0];
  assert(ledger.total === "0.05" && Number(ledger.quantity) === 0.3 && Number(ledger.debit) === 0.05, "Fractional receipt value does not reconcile to its stock/accounting entry");
  const receipts = (await pg.query('SELECT COUNT(*)::int AS count FROM "GoodsReceipt" WHERE "purchaseOrderId"=$1', [order.id])).rows[0];
  assert(receipts.count === 3, "Retry created an extra receipt or delivery evidence is missing");
  steps.push("verify every delivery has one receipt and all order lines reconcile to stock and accounting");

  const correctedExpiry = new Date(Date.now() + 1095 * 86400000).toISOString().slice(0, 10);
  await api("correct current batch expiry independently of original receipt", "/api/supply", post({ action: "CORRECT_BATCH_EXPIRY", idempotencyKey: randomUUID(), batchId: first.id, expiryDate: correctedExpiry, reason: "Synthetic manufacturer date correction" }));
  await pg.query('UPDATE "Supplier" SET "name"=$2 WHERE "id"=$1', [supplier.id, "Renamed synthetic supplier"]);
  const retained = (await api("print original receipt after supplier and stock metadata changes", "/api/supply/documents", post({ kind: "GOODS_RECEIPT", id: first.goodsReceiptId, intent: "PRINT" }))).body.document;
  assert(JSON.stringify(retained) === JSON.stringify(preview), "Receipt print changed after supplier or batch corrections");
  for (const statement of ['UPDATE "GoodsReceipt" SET "snapshot"=\'{}\'::jsonb WHERE "id"=$1', 'DELETE FROM "GoodsReceipt" WHERE "id"=$1']) {
    let rejected = false;
    try { await pg.query(statement, [first.goodsReceiptId]); } catch (error) { rejected = /immutable/.test(error.message); }
    assert(rejected, "Posted receipt could be overwritten or deleted");
  }
  steps.push("verify original receipt survives metadata corrections and rejects update/deletion");

  const foreignUser = randomUUID();
  await pg.query(`INSERT INTO "User" ("id","facilityId","email","displayName","passwordHash","mustChangePassword","updatedAt")
    SELECT $1,$2,'supply@example.test','Other facility supply manager',"passwordHash",false,now() FROM "User" WHERE "facilityId"=$3 AND "email"='admin@mwein.local'`, [foreignUser, otherFacilityId, facility.id]);
  await pg.query('INSERT INTO "UserRole" ("userId","roleId") SELECT $1,"id" FROM "Role" WHERE "code"=\'PHARMACY_MANAGER\'', [foreignUser]);
  const foreign = await authenticate("OTHER", "supply@example.test");
  const foreignList = await requestWithCookie("/api/supply/documents", foreign.cookie);
  assert(foreignList.response.ok && foreignList.body.documents.length === 0, "Document list leaked records across facilities");
  for (const [kind, id] of [["GOODS_RECEIPT", first.goodsReceiptId], ["PURCHASE_ORDER", order.id]]) {
    const denied = await requestWithCookie("/api/supply/documents", foreign.cookie, post({ kind, id, intent: "PRINT" }));
    assert(denied.response.status === 404, "Foreign facility could print a supply document");
  }
  const foreignReplay = await requestWithCookie("/api/supply", foreign.cookie, post(receiptInput));
  assert(foreignReplay.response.status === 409, "Receipt retry disclosed another facility's transaction");
  const reception = await authenticate("MMS", "reception@example.test");
  assert((await requestWithCookie("/api/supply/documents", reception.cookie)).response.status === 403, "Reception could read procurement documents");
  steps.push("verify supply document roles and facility isolation including receipt retries");

  const cancelledOrder = (await api("draft cancellable purchase order", "/api/supply", post({ action: "PURCHASE_ORDER", idempotencyKey: randomUUID(), supplierId: supplier.id, catalogItemId: medicine.id, quantity: 5, unitCost: 2 }))).body.result;
  await api("cancel purchase order with retained reason", "/api/supply", post({ action: "CANCEL_PURCHASE_ORDER", purchaseOrderId: cancelledOrder.id, reason: "Synthetic supplier unable to deliver" }));
  const cancelled = (await api("resolve current cancellation when printing", "/api/supply/documents", post({ kind: "PURCHASE_ORDER", id: cancelledOrder.id, intent: "PRINT" }))).body.document;
  assert(cancelled.status === "CANCELLED" && cancelled.cancellationReason && cancelled.actors.some(actor => actor.label === "Cancelled by"), "Cancelled print omitted its status, reason or actor");
  const list = await api("list retained purchase and receipt documents", "/api/supply/documents");
  assert(list.body.documents.filter(record => record.kind === "GOODS_RECEIPT").length === 3 && list.body.documents.filter(record => record.kind === "PURCHASE_ORDER").length === 2, "Document index omitted posted records");
}
