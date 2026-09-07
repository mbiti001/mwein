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
      <div className="supplyGrid">
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
