"use client";
import { FormEvent, useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { FormSearchablePicker } from "@/components/SearchablePicker";

type Data = {
  suppliers: any[];
  stores: any[];
  purchaseOrders: any[];
  items: any[];
  batches: any[];
  pendingCounts: any[];
  emergencyAdjustments: any[];
  movements: any[];
  stocktakes: any[];
  accounting: null | {
    inventoryValue: number;
    unvaluedUnits: number;
    sales: number;
    costOfGoodsSold: number;
    grossProfit: number;
    fastMoving: any[];
    journals: any[];
  };
  currentUserId: string;
};
const empty: Data = {
  suppliers: [],
  stores: [],
  purchaseOrders: [],
  items: [],
  batches: [],
  pendingCounts: [],
  emergencyAdjustments: [],
  movements: [],
  stocktakes: [],
  accounting: null,
  currentUserId: "",
};

export default function SupplyWorkstation({
  permissions,
  view = "controls",
}: {
  permissions: string[];
  view?: "receive" | "history" | "controls";
}) {
  const [data, setData] = useState<Data>(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [movementQuery, setMovementQuery] = useState("");
  const can = (permission: string) => permissions.includes(permission);
  async function load() {
    setData(
      await jsonRequest<Data>(
        "/api/supply",
        undefined,
        "Supply-chain data could not be loaded",
      ),
    );
  }
  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, []);
  async function save(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        "/api/supply",
        { method: "POST", body: JSON.stringify(body) },
        "Supply-chain transaction could not be saved",
      );
      setNotice(success);
      await load();
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(
      [...new FormData(form).entries()].filter(([, value]) => value !== ""),
    );
    const keyed = [
      "PURCHASE_ORDER",
      "RECEIVE",
      "COUNT",
      "TRANSFER",
      "EMERGENCY_ADJUST",
      "START_STOCKTAKE",
    ].includes(action);
    if (
      await save(
        {
          action,
          ...body,
          ...(keyed ? { idempotencyKey: crypto.randomUUID() } : {}),
        },
        `${action.replaceAll("_", " ").toLowerCase()} saved.`,
      )
    )
      form.reset();
  }
  async function submitStocktake(event: FormEvent<HTMLFormElement>, stocktake: any) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = stocktake.lines.map((line: any) => ({
      lineId: line.id,
      countedQuantity: form.get(`count-${line.id}`),
      reason: form.get(`reason-${line.id}`) || undefined,
    }));
    await save(
      { action: "SUBMIT_STOCKTAKE", idempotencyKey: crypto.randomUUID(), stocktakeId: stocktake.id, lines },
      `${stocktake.stocktakeNumber} submitted for independent approval.`,
    );
  }
  async function cancelStocktake(stocktake: any) {
    const reason = window.prompt(`Why are you cancelling ${stocktake.stocktakeNumber}?`);
    if (!reason) return;
    await save(
      { action: "CANCEL_STOCKTAKE", stocktakeId: stocktake.id, reason },
      `${stocktake.stocktakeNumber} cancelled. Stock movements are available again.`,
    );
  }
  const receivable = data.purchaseOrders
    .filter((order) =>
      ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status),
    )
    .flatMap((order) =>
      order.lines
        .filter(
          (line: any) =>
            Number(line.quantityReceived) < Number(line.quantityOrdered),
        )
        .map((line: any) => ({ ...line, orderNumber: order.orderNumber })),
    );
  const receiptForm = can("inventory.receive") ? (
    <form className="card dataForm" onSubmit={(event) => submit(event, "RECEIVE")}>
      <div className="wide"><h2>Goods receipt (GRN)</h2><p>Receive a supplier delivery against an independently approved purchase order.</p></div>
      <label>Approved PO line *<FormSearchablePicker name="lineId" required placeholder="Search purchase order or medicine…" options={receivable.map(line => ({ value: line.id, label: `${line.orderNumber} · ${data.items.find(item => item.id === line.catalogItemId)?.name || "Medicine"}` }))}/></label>
      <label>Receiving store *<select name="storeId" required><option value="">Select</option>{data.stores.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Batch number *<input name="batchNumber" required /></label>
      <label>Expiry date *<input name="expiryDate" type="date" required /></label>
      <label>Quantity received *<input name="quantity" type="number" min="0.001" step="0.001" required /></label>
      <button className="primary wide" disabled={busy || receivable.length === 0}>{receivable.length ? "Post goods receipt" : "No approved order awaiting receipt"}</button>
    </form>
  ) : null;
  if (view === "receive") return <>
    <header><div><p className="eyebrow">Pharmacy inventory</p><h1>Receive stock</h1><p>Record the batch, expiry, quantity and destination store at the moment goods arrive.</p></div></header>
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    {receiptForm || <section className="card"><p>Your role cannot receive stock.</p></section>}
  </>;
  if (view === "history") {
    const term = movementQuery.trim().toLowerCase();
    const movements = data.movements.filter(movement => `${movement.batch.catalogItem.name} ${movement.batch.catalogItem.code} ${movement.batch.batchNumber} ${movement.type} ${movement.sourceStore?.name || ""} ${movement.destinationStore?.name || ""} ${movement.user.displayName}`.toLowerCase().includes(term));
    return <>
      <header><div><p className="eyebrow">Pharmacy inventory</p><h1>Stock movement history</h1><p>Trace receipts, dispensing, transfers, stock corrections and expiry corrections.</p></div></header>
      {error && <div className="alert">{error}</div>}
      <section className="card compact"><div className="cardHead"><div><h2>Movement ledger</h2><p>Latest 150 events for this facility.</p></div><strong>{movements.length}</strong></div>
        <label className="listSearch">Search movements<input type="search" value={movementQuery} onChange={event => setMovementQuery(event.target.value)} placeholder="Medicine, batch, movement, store or staff" /></label>
        <div className="queue movementList">{movements.map(movement => <article className="row movementRow" key={movement.id}><span className="dot"/><div><strong>{movement.batch.catalogItem.name} · {movement.type.replaceAll("_", " ")}</strong><small>Batch {movement.batch.batchNumber} · {movement.sourceStore?.name || "External"} → {movement.destinationStore?.name || "Dispensed / adjusted"}</small><small>{movement.reason || "No reason recorded"} · {movement.user.displayName} · {new Date(movement.occurredAt).toLocaleString()}</small></div><div className="movementQuantity"><b>{["DISPENSE", "ADJUSTMENT"].includes(movement.type) && Number(movement.quantity) > 0 ? "−" : movement.type === "RECEIPT" ? "+" : ""}{Number(movement.quantity)}</b><small>Batch balance {Number(movement.balanceAfter)}</small></div></article>)}{!movements.length && <div className="empty"><strong>No matching movements</strong><p>Receipts and stock activity will appear here.</p></div>}</div>
      </section>
    </>;
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Pharmacy inventory</p>
          <h1>Ordering & stock controls</h1>
          <p>
            Draft and independently approve purchase orders, count stock and
            transfer medicines with batch traceability.
          </p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Purchase orders</h2>
            <p>Only independently approved orders can be received.</p>
          </div>
          <strong>{data.purchaseOrders.length}</strong>
        </div>
        <div className="queue">
          {data.purchaseOrders.map((order) => (
            <div className="row" key={order.id}>
              <span className="dot" />
              <div>
                <strong>
                  {order.orderNumber} · {order.supplier.name}
                </strong>
                <small>
                  {order.status.replaceAll("_", " ")} · {order.lines.length}{" "}
                  line(s)
                </small>
              </div>
              <div className="actions">
                {order.status === "DRAFT" && can("procurement.create") && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void save(
                        {
                          action: "SUBMIT_PURCHASE_ORDER",
                          purchaseOrderId: order.id,
                        },
                        `${order.orderNumber} submitted for approval.`,
                      )
                    }
                  >
                    Submit
                  </button>
                )}
                {order.status === "SUBMITTED" &&
                  can("procurement.approve") &&
                  order.createdById !== data.currentUserId &&
                  order.submittedById !== data.currentUserId && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void save(
                          {
                            action: "APPROVE_PURCHASE_ORDER",
                            purchaseOrderId: order.id,
                          },
                          `${order.orderNumber} approved.`,
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {data.pendingCounts.length > 0 && (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Pending stock variances</h2>
              <p>
                A different authorized user must approve before balances change.
              </p>
            </div>
            <strong>{data.pendingCounts.length}</strong>
          </div>
          <div className="queue">
            {data.pendingCounts.map((item) => (
              <div className="row" key={item.id}>
                <span className="dot" />
                <div>
                  <strong>
                    {data.batches.find((batch) => batch.id === item.batchId)
                      ?.catalogItem.name || "Stock count"}
                  </strong>
                  <small>
                    Count {Number(item.quantity)} · variance{" "}
                    {Number(item.variance)} · {item.reason}
                  </small>
                </div>
                {can("inventory.adjust") &&
                  item.recordedById !== data.currentUserId && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void save(
                          { action: "APPROVE_COUNT", eventId: item.id },
                          "Stock variance approved and posted.",
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
              </div>
            ))}
          </div>
        </section>
      )}
      {data.emergencyAdjustments.length > 0 && (
        <section className="card emergencyPanel">
          <div className="cardHead">
            <div>
              <h2>Emergency adjustments awaiting physical count</h2>
              <p>
                These balances are usable but remain unreconciled until another
                user records the count.
              </p>
            </div>
            <strong>{data.emergencyAdjustments.length}</strong>
          </div>
        </section>
      )}
      {data.stocktakes.length > 0 && (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Full-store stocktakes</h2>
              <p>Counts are blind while open. Store movements remain frozen until approval or cancellation.</p>
            </div>
            <strong>{data.stocktakes.length}</strong>
          </div>
          <div className="queue">
            {data.stocktakes.map((stocktake) => (
              <article className="card compact" key={stocktake.id}>
                <div className="cardHead">
                  <div>
                    <h3>{stocktake.stocktakeNumber} · {stocktake.store.name}</h3>
                    <p>{stocktake.status} · opened by {stocktake.openedBy.displayName} · {new Date(stocktake.openedAt).toLocaleString()}</p>
                  </div>
                  <b>{stocktake.lines.length} batches</b>
                </div>
                {stocktake.status === "OPEN" && can("inventory.count") && (
                  <form className="dataForm" onSubmit={(event) => void submitStocktake(event, stocktake)}>
                    <div className="wide privacyNotice">
                      <strong>Blind physical count</strong>
                      <span>Enter every physical quantity. Add a reason where you observed damage, loss, an unrecorded receipt, or another likely variance.</span>
                    </div>
                    {stocktake.lines.map((line: any) => (
                      <div className="wide stocktakeLine" key={line.id}>
                        <label>{line.batch.catalogItem.name} · batch {line.batch.batchNumber}
                          <input name={`count-${line.id}`} type="number" min="0" step="0.001" required aria-label={`Counted quantity for ${line.batch.catalogItem.name} batch ${line.batch.batchNumber}`} />
                        </label>
                        <label>Variance reason if different
                          <input name={`reason-${line.id}`} minLength={5} maxLength={240} />
                        </label>
                      </div>
                    ))}
                    <div className="wide submitBar">
                      <button type="button" className="secondary" disabled={busy} onClick={() => void cancelStocktake(stocktake)}>Cancel stocktake</button>
                      <button className="primary" disabled={busy}>{busy ? "Submitting…" : "Submit complete count"}</button>
                    </div>
                  </form>
                )}
                {stocktake.status === "SUBMITTED" && (
                  <>
                    <div className="queue compact">
                      {stocktake.lines.map((line: any) => (
                        <div className="row" key={line.id}>
                          <span className="dot" />
                          <div><strong>{line.batch.catalogItem.name} · {line.batch.batchNumber}</strong><small>System {Number(line.systemQuantity)} · counted {Number(line.countedQuantity)} · variance {Number(line.variance)}{line.reason ? ` · ${line.reason}` : ""}</small></div>
                        </div>
                      ))}
                    </div>
                    <div className="submitBar">
                      {can("inventory.reconcile") && <button type="button" className="secondary" disabled={busy} onClick={() => void cancelStocktake(stocktake)}>Cancel stocktake</button>}
                      {can("inventory.reconcile") && stocktake.openedById !== data.currentUserId && stocktake.submittedById !== data.currentUserId && <button type="button" className="primary" disabled={busy} onClick={() => void save({ action: "APPROVE_STOCKTAKE", idempotencyKey: crypto.randomUUID(), stocktakeId: stocktake.id }, `${stocktake.stocktakeNumber} approved and posted.`)}>Approve and post variances</button>}
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {data.accounting && (
        <section className="card">
          <div className="cardHead"><div><h2>Pharmacy inventory accounting</h2><p>Perpetual inventory value, dispensing margin and balanced journal entries.</p></div><strong>KES {data.accounting.inventoryValue.toLocaleString()}</strong></div>
          <div className="metricGrid">
            <article className="metric"><span>30-day sales</span><strong>KES {data.accounting.sales.toLocaleString()}</strong></article>
            <article className="metric"><span>Cost of goods sold</span><strong>KES {data.accounting.costOfGoodsSold.toLocaleString()}</strong></article>
            <article className="metric"><span>Gross profit</span><strong>KES {data.accounting.grossProfit.toLocaleString()}</strong></article>
            <article className={`metric ${data.accounting.unvaluedUnits ? "urgent" : ""}`}><span>Unvalued units</span><strong>{data.accounting.unvaluedUnits.toLocaleString()}</strong></article>
          </div>
          <div className="queue compact">{data.accounting.journals.slice(0, 20).map((journal: any) => <div className="row" key={journal.id}><span className="dot"/><div><strong>{journal.entryNumber} · {journal.description}</strong><small>{new Date(journal.occurredAt).toLocaleString()} · {journal.lines.map((line: any) => `${line.accountCode} ${Number(line.debit) ? `Dr ${Number(line.debit)}` : `Cr ${Number(line.credit)}`}`).join(" · ")}</small></div></div>)}</div>
        </section>
      )}
      <div className="supplyGrid">
        {can("inventory.count") && (
          <form className="card dataForm" onSubmit={(event) => submit(event, "START_STOCKTAKE")}>
            <div className="wide"><h2>Start full-store stocktake</h2><p>Starting a count freezes receipts, dispensing, transfers and adjustments for the selected store.</p></div>
            <label>Store *<select name="storeId" required><option value="">Select</option>{data.stores.filter(store => !data.stocktakes.some(stocktake => stocktake.storeId === store.id && ["OPEN", "SUBMITTED"].includes(stocktake.status))).map(store => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
            <label>Count note<input name="notes" maxLength={500} placeholder="Scheduled month-end count" /></label>
            <button className="primary wide" disabled={busy}>Start blind count</button>
          </form>
        )}
        {can("procurement.manage_suppliers") && (
          <form
            className="card dataForm"
            onSubmit={(event) => submit(event, "SUPPLIER")}
          >
            <h2 className="wide">Supplier</h2>
            <label>
              Code *<input name="code" required />
            </label>
            <label>
              Name *<input name="name" required />
            </label>
            <label>
              Phone
              <input name="phone" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <button className="primary wide" disabled={busy}>
              Save supplier
            </button>
          </form>
        )}
        {can("inventory.manage_stores") && (
          <form
            className="card dataForm"
            onSubmit={(event) => submit(event, "STORE")}
          >
            <h2 className="wide">Store</h2>
            <label>
              Code *<input name="code" required />
            </label>
            <label>
              Name *<input name="name" required />
            </label>
            <button className="primary wide" disabled={busy}>
              Save store
            </button>
          </form>
        )}
        {can("procurement.create") && (
          <form
            className="card dataForm"
            onSubmit={(event) => submit(event, "PURCHASE_ORDER")}
          >
            <h2 className="wide">New purchase order</h2>
            <label>
              Supplier *
              <FormSearchablePicker name="supplierId" required placeholder="Search supplier…" options={data.suppliers.map(item => ({ value: item.id, label: item.name, detail: item.code }))}/>
            </label>
            <label>
              Medicine *
              <FormSearchablePicker name="catalogItemId" required placeholder="Search medicine…" options={data.items.map(item => ({ value: item.id, label: item.name, detail: item.code }))}/>
            </label>
            <label>
              Quantity *
              <input
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </label>
            <label>
              Unit cost
              <input name="unitCost" type="number" min="0" step="0.01" />
            </label>
            <label>
              Expected date
              <input name="expectedAt" type="date" />
            </label>
            <label>
              Note
              <input name="notes" />
            </label>
            <button className="primary wide" disabled={busy}>
              Save draft
            </button>
          </form>
        )}
        {can("inventory.count") && (
          <form
            className="card dataForm"
            onSubmit={(event) => submit(event, "COUNT")}
          >
            <h2 className="wide">Stock count</h2>
            <label>
              Store *
              <select name="storeId" required>
                <option value="">Select</option>
                {data.stores.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch *
              <FormSearchablePicker name="batchId" required placeholder="Search medicine or batch…" options={data.batches.map(item => ({ value: item.id, label: item.catalogItem.name, detail: item.batchNumber }))}/>
            </label>
            <label>
              Counted quantity *
              <input
                name="countedQuantity"
                type="number"
                min="0"
                step="0.001"
                required
              />
            </label>
            <label>
              Variance reason *<input name="reason" minLength={5} required />
            </label>
            <button className="primary wide" disabled={busy}>
              Submit count
            </button>
          </form>
        )}
        {can("inventory.adjust") && (
          <form
            className="card dataForm emergencyPanel"
            onSubmit={(event) => submit(event, "EMERGENCY_ADJUST")}
          >
            <div className="wide">
              <h2>Emergency stock correction</h2>
              <p>
                Use only when patient care cannot wait. Another user must
                complete a physical count.
              </p>
            </div>
            <label>
              Store *
              <select name="storeId" required>
                <option value="">Select</option>
                {data.stores.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch *
              <FormSearchablePicker name="batchId" required placeholder="Search medicine or batch…" options={data.batches.map(item => ({ value: item.id, label: item.catalogItem.name, detail: item.batchNumber }))}/>
            </label>
            <label>
              Correct usable quantity *
              <input
                name="newQuantity"
                type="number"
                min="0"
                step="0.001"
                required
              />
            </label>
            <label>
              Emergency reason *<input name="reason" minLength={10} required />
            </label>
            <button className="primary wide" disabled={busy}>
              Apply emergency correction
            </button>
          </form>
        )}
        {can("inventory.transfer") && (
          <form
            className="card dataForm"
            onSubmit={(event) => submit(event, "TRANSFER")}
          >
            <h2 className="wide">Stock transfer</h2>
            <label>
              Source *
              <select name="sourceStoreId" required>
                <option value="">Select</option>
                {data.stores.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Destination *
              <select name="destinationStoreId" required>
                <option value="">Select</option>
                {data.stores.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch *
              <FormSearchablePicker name="batchId" required placeholder="Search medicine or batch…" options={data.batches.map(item => ({ value: item.id, label: item.catalogItem.name, detail: item.batchNumber }))}/>
            </label>
            <label>
              Quantity *
              <input
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </label>
            <label className="wide">
              Reason *<input name="reason" minLength={5} required />
            </label>
            <button className="primary wide" disabled={busy}>
              Transfer stock
            </button>
          </form>
        )}
      </div>
    </>
  );
}
