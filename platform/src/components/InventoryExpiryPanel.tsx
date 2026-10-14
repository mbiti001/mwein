"use client";

import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { expiryReport, type ExpiryBatch, type ExpiryWindow } from "@/lib/expiry-report";

type Snapshot = { batches: ExpiryBatch[]; stores: { id: string; name: string }[]; asOf: Date };

export default function InventoryExpiryPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [window, setWindow] = useState<ExpiryWindow>("30");
  const [storeId, setStoreId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSnapshot(null);
    void jsonRequest<Omit<Snapshot, "asOf">>("/api/supply", { cache: "no-store" }, "Expiry report could not be loaded")
      .then(data => { if (active) setSnapshot({ batches: data.batches, stores: data.stores, asOf: new Date() }); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const rows = snapshot ? expiryReport(snapshot.batches, { now: snapshot.asOf, window, storeId, query }) : [];
  return <>
    <div className="cardHead"><div><p className="eyebrow">Pharmacy inventory</p><h1>Batch expiry report</h1>
      <p>Review stock by expiry and store before taking action through stock controls.</p></div>
      <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh report</button>
    </div>
    {error && <div className="alert" role="alert">{error}</div>}
    {loading && <p role="status">Loading expiry report…</p>}
    {snapshot && !loading && <section className="card">
      <div className="dataForm">
        <label>Expiry window<select value={window} onChange={event => setWindow(event.target.value as ExpiryWindow)}>
          <option value="expired">Expired stock</option><option value="30">Due within 30 days</option>
          <option value="90">Due within 90 days</option><option value="all">All stock on hand</option>
        </select></label>
        <label>Store<select value={storeId} onChange={event => setStoreId(event.target.value)}>
          <option value="">All stores (facility total)</option>
          {snapshot.stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select></label>
        <label>Search medicine or batch<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Medicine, code or batch number" /></label>
      </div>
      <p>Snapshot: {snapshot.asOf.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} EAT · {rows.length} batch(es). Upcoming windows exclude expired stock.</p>
      <p>Expired batches require review through authorised stock controls. Invalid dates require investigation. This report does not change stock balances.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="reportResults"><caption>Stock on hand for the selected expiry window and store</caption>
          <thead><tr><th scope="col">Medicine</th><th scope="col">Batch</th><th scope="col">Expiry (EAT)</th><th scope="col">Status</th><th scope="col">Quantity on hand</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td><strong>{row.catalogItem.name}</strong><small style={{ display: "block" }}>{row.catalogItem.code}</small></td>
            <td>{row.batchNumber}</td>
            <td>{row.validExpiry ? new Date(row.expiryDate).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" }) : "Invalid date"}</td>
            <td>{!row.validExpiry ? "Investigate date" : row.expired ? "Expired" : `${row.daysRemaining} day(s) remaining`}</td>
            <td>{row.quantity.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <div className="empty" role="status"><strong>No stock matches these filters</strong><p>Try a different expiry window, store or search.</p></div>}
    </section>}
  </>;
}
