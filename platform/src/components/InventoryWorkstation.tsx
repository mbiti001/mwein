"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Batch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantityAvailable: string;
  locationBalances: { quantity: string; store: { name: string } }[];
};

type Item = {
  id: string;
  code: string;
  name: string;
  reorderLevel?: string | null;
  unitOfMeasure?: string | null;
  inventoryBatches: Batch[];
};

export type StockFocus = { catalogItemId?: string | null; batchId?: string | null };

export default function InventoryWorkstation({
  permissions,
  focus,
  onFocusConsumed,
}: {
  permissions: string[];
  focus?: StockFocus | null;
  onFocusConsumed?: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | "LOW" | "AVAILABLE" | "EMPTY" | "EXPIRING">("ALL");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const canCorrectExpiry = permissions.includes("inventory.correct_metadata");

  async function load() {
    const result = await jsonRequest<{ items: Item[] }>("/api/inventory", undefined, "Inventory could not be loaded");
    setItems(result.items);
    return result.items;
  }

  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, []);
  useEffect(() => {
    if (!focus || !items.length) return;
    const item = items.find((candidate) => candidate.id === focus.catalogItemId || candidate.inventoryBatches.some((batch) => batch.id === focus.batchId));
    if (item) {
      setQuery(item.name);
      setStatus("ALL");
      setExpandedItemId(item.id);
      const batch = item.inventoryBatches.find((candidate) => candidate.id === focus.batchId);
      if (batch && canCorrectExpiry) setEditingBatch(batch);
    }
    onFocusConsumed?.();
  }, [canCorrectExpiry, focus, items, onFocusConsumed]);

  const matching = useMemo(() => {
    const inNinetyDays = Date.now() + 90 * 86400000;
    return items.filter((item) => {
      const available = item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0);
      const low = item.reorderLevel != null && available <= Number(item.reorderLevel);
      const expiring = item.inventoryBatches.some((batch) => Number(batch.quantityAvailable) > 0 && new Date(batch.expiryDate).getTime() <= inNinetyDays);
      const text = `${item.name} ${item.code} ${item.inventoryBatches.map((batch) => batch.batchNumber).join(" ")}`.toLowerCase();
      return text.includes(query.trim().toLowerCase()) && (
        status === "ALL" ||
        (status === "LOW" && low) ||
        (status === "AVAILABLE" && available > 0) ||
        (status === "EMPTY" && available === 0) ||
        (status === "EXPIRING" && expiring)
      );
    });
  }, [items, query, status]);
  const visible = matching.slice(0, 8);

  async function correctExpiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBatch) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest("/api/supply", { method: "POST", body: JSON.stringify({
        action: "CORRECT_BATCH_EXPIRY",
        idempotencyKey: crypto.randomUUID(),
        batchId: editingBatch.id,
        expiryDate: form.get("expiryDate"),
        reason: form.get("reason"),
      }) }, "Expiry correction could not be saved");
      setNotice(`Expiry for batch ${editingBatch.batchNumber} corrected and added to movement history.`);
      setEditingBatch(null);
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <header><div><p className="eyebrow">Pharmacy inventory</p><h1>Manage inventory</h1><p>Open any medicine to inspect its batches, store balances and expiry dates.</p></div></header>
    {error && <div className="alert">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}
    {editingBatch && <section className="card stockEditPanel">
      <div className="cardHead"><div><h2>Correct batch expiry</h2><p>{editingBatch.batchNumber} · current expiry {new Date(editingBatch.expiryDate).toLocaleDateString()}</p></div><button className="secondary" type="button" onClick={() => setEditingBatch(null)}>Cancel</button></div>
      <form className="dataForm" onSubmit={correctExpiry}>
        <label>Correct expiry date *<input name="expiryDate" type="date" defaultValue={editingBatch.expiryDate.slice(0, 10)} required /></label>
        <label>Correction reason *<input name="reason" minLength={5} maxLength={240} placeholder="Wrong date entered on receipt" required /></label>
        <div className="wide submitBar"><span>This changes metadata only. Quantity corrections still use a controlled stock count.</span><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save expiry correction"}</button></div>
      </form>
    </section>}
    <section className="card compact">
      <div className="cardHead"><div><h2>Find stock</h2><p>Search by medicine, code or batch. Select a record to view and correct details.</p></div><strong>{visible.length} of {matching.length}</strong></div>
      <div className="inventorySearch"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medicine, item code or batch number…" aria-label="Search inventory"/><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter inventory status"><option value="ALL">All stock</option><option value="LOW">Reorder needed</option><option value="EXPIRING">Expiring in 90 days</option><option value="AVAILABLE">In stock</option><option value="EMPTY">No usable stock</option></select></div>
      <div className="stockItemList">{visible.map((item) => {
        const available = item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0);
        const reorder = item.reorderLevel != null && available <= Number(item.reorderLevel);
        return <details className={`stockItem ${reorder ? "urgent" : ""}`} open={expandedItemId === item.id || undefined} onToggle={(event) => { if (event.currentTarget.open) setExpandedItemId(item.id); }} key={item.id}>
          <summary className="row"><span className="dot"/><div><strong>{item.name}</strong><small>{item.code} · {item.inventoryBatches.length} batch{item.inventoryBatches.length === 1 ? "" : "es"}</small></div><b>{available} {item.unitOfMeasure || "units"}</b><time>{reorder ? "REORDER" : available > 0 ? "IN STOCK" : "NO STOCK"}</time></summary>
          <div className="batchList">{item.inventoryBatches.map((batch) => {
            const days = Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / 86400000);
            return <article className={`batchRow ${days <= 90 ? "urgent" : ""}`} key={batch.id}><div><strong>Batch {batch.batchNumber}</strong><small>{batch.locationBalances.map((balance) => `${balance.store.name}: ${Number(balance.quantity)}`).join(" · ") || "No store balance"}</small></div><div><small>Available</small><b>{Number(batch.quantityAvailable)}</b></div><div><small>Expiry</small><b>{new Date(batch.expiryDate).toLocaleDateString()}</b><span>{days < 0 ? "EXPIRED" : days <= 90 ? `${days} days` : "Current"}</span></div>{canCorrectExpiry && <button className="secondary" type="button" onClick={() => { setEditingBatch(batch); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit expiry</button>}</article>;
          })}{!item.inventoryBatches.length && <div className="empty"><strong>No batches received</strong><p>Use Receive stock after an approved purchase order is available.</p></div>}</div>
        </details>;
      })}{!visible.length && <div className="empty"><strong>No matching stock</strong><p>Change the search or stock-status filter.</p></div>}{matching.length > 8 && <p className="listHint">{matching.length - 8} more matches hidden. Refine the search to narrow the list.</p>}</div>
    </section>
  </>;
}
