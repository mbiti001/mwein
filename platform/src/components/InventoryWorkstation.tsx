"use client";
import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Item = { id: string; code: string; name: string; reorderLevel?: string | null; unitOfMeasure?: string | null; inventoryBatches: { id: string; batchNumber: string; expiryDate: string; quantityAvailable: string; locationBalances: { quantity: string; store: { name: string } }[] }[] };

export default function InventoryWorkstation() {
  const [items, setItems] = useState<Item[]>([]); const [error, setError] = useState("");
  useEffect(() => { void jsonRequest<{ items: Item[] }>("/api/inventory", undefined, "Inventory could not be loaded").then(data => setItems(data.items)).catch(reason => setError(reason.message)); }, []);
  return <><header><div><p className="eyebrow">Pharmacy inventory</p><h1>Batch and expiry stock control</h1><p>Monitor balances by batch and store. Goods receipt is controlled from approved purchase orders in Supply chain.</p></div></header>{error && <div className="alert">{error}</div>}<section className="card compact"><div className="cardHead"><div><h2>Available stock</h2><p>Near-expiry and reorder status by medicine.</p></div></div><div className="queue">{items.map(item => { const available = item.inventoryBatches.reduce((sum, batch) => sum + Number(batch.quantityAvailable), 0); const reorder = item.reorderLevel != null && available <= Number(item.reorderLevel); return <div className={`row ${reorder ? "urgent" : ""}`} key={item.id}><span className="dot"/><div><strong>{item.name}</strong><small>{item.inventoryBatches.length ? item.inventoryBatches.map(batch => `${batch.batchNumber}: ${Number(batch.quantityAvailable)} · ${batch.locationBalances.map(balance => `${balance.store.name} ${Number(balance.quantity)}`).join(", ")} · exp ${new Date(batch.expiryDate).toLocaleDateString()}`).join(" | ") : "No usable batches"}</small></div><b>{available} {item.unitOfMeasure || "units"}</b><time>{reorder ? "REORDER" : "IN STOCK"}</time></div>; })}</div></section></>;
}
