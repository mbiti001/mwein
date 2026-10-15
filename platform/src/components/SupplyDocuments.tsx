"use client";
import { RecordFields } from "./RecordFields";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FacilityLetterhead } from "@/components/FacilityBrand";
import { jsonRequest } from "@/lib/client-http";
import { supplyDocumentStatus, type SupplyDocument, type SupplyDocumentIndex } from "@/lib/supply-documents";

const when = (value: string) => new Date(value).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
const money = (value: string | null) => value === null ? "Not recorded" : Number(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SupplyDocumentPaper({ record }: { record: SupplyDocument }) {
  const receipt = record.kind === "GOODS_RECEIPT";
  return <article className="clinicFormPaper supplyDocumentPaper">
    <FacilityLetterhead facilityName={record.facilityName} title={receipt ? "Goods receipt note" : "Local purchase order"} reference={record.reference} badge={<strong>{supplyDocumentStatus(record)}</strong>} />
    <RecordFields title="Supplier and document details" fields={[
      { label: "Supplier", value: record.supplier.name }, { label: "Supplier code", value: record.supplier.code },
      { label: "Phone", value: record.supplier.phone }, { label: "Email", value: record.supplier.email },
      { label: "Facility", value: record.facilityCode }, { label: receipt ? "Received" : "Created", value: `${when(record.date)} EAT` },
      { label: "Order", value: record.orderNumber }, { label: "Expected delivery", value: record.expectedAt },
    ]} />
    {record.cancellationReason && <p className="alert">Cancellation reason: {record.cancellationReason}</p>}
    <div className="supplyDocumentTableWrap"><table className="reportResults">
      <thead><tr><th>Item / code</th>{receipt && <th>Batch / expiry / store</th>}<th>{receipt ? "Received quantity" : "Ordered quantity"}</th>{!receipt && <th>Received to date</th>}<th>Unit cost (KES)</th><th>Value (KES)</th></tr></thead>
      <tbody>{record.lines.map((line, index) => <tr key={index}><td><strong>{line.name}</strong><small>{line.code}</small></td>{receipt && <td>{line.batchNumber}<br />Expiry: {line.expiryDate}<br />{line.storeName}</td>}<td>{line.quantity}</td>{!receipt && <td>{line.receivedQuantity}</td>}<td>{money(line.unitCost)}</td><td>{money(line.total)}</td></tr>)}</tbody>
    </table></div>
    <p className="supplyDocumentTotal"><strong>Total value: KES {money(record.total)}</strong></p>
    <RecordFields fields={[{ label: "Notes", value: record.notes, wide: true }]} />
    <footer className="documentSignature">{record.actors.map(actor => <span key={actor.label}><strong>{actor.label}: {actor.name}</strong> · {when(actor.at)} EAT</span>)}</footer>
    <p className="formUseNote">{receipt ? "Posted stock receipt. The details above were retained when the delivery was received. Later stock corrections are recorded separately. This is not a supplier tax invoice." : "Current order record. Only an approved order authorises supply. Received quantities reflect the current ledger; this document is not proof of delivery."}</p>
  </article>;
}

export default function SupplyDocuments() {
  const [records, setRecords] = useState<SupplyDocumentIndex[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState<{ index: SupplyDocumentIndex; document: SupplyDocument } | null>(null);
  const [printing, setPrinting] = useState<SupplyDocument | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const preparing = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current;
    setLoading(true); setError(""); setRecords([]); setActive(null);
    void jsonRequest<{ documents: SupplyDocumentIndex[]; truncated: boolean }>("/api/supply/documents", { cache: "no-store" })
      .then(data => { if (ticket === generation.current) { setRecords(data.documents); setTruncated(data.truncated); } })
      .catch(e => { if (ticket === generation.current) setError(e.message); })
      .finally(() => { if (ticket === generation.current) setLoading(false); });
    return () => { generation.current++; document.body.classList.remove("printingSupplyDocument"); };
  }, [refresh]);
  async function prepare(index: SupplyDocumentIndex, intent: "PREVIEW" | "PRINT") {
    if (preparing.current) return;
    preparing.current = true;
    const ticket = generation.current;
    setBusy(true); setError(""); setActive(null);
    try {
      const result = await jsonRequest<{ document: SupplyDocument }>("/api/supply/documents", { method: "POST", body: JSON.stringify({ kind: index.kind, id: index.id, intent }) });
      if (ticket !== generation.current) return;
      setActive({ index, document: result.document });
      if (intent === "PRINT") {
        setPrinting(result.document);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#supply-document-print img")).map(img => img.decode()));
        if (ticket !== generation.current) return;
        document.body.classList.add("printingSupplyDocument");
        const previousTitle = document.title;
        const printTitle = `${result.document.reference} - ${result.document.kind === "GOODS_RECEIPT" ? "Goods receipt note" : "Purchase order"}`;
        try {
          // Browsers use the page title for the PDF filename and printed header.
          document.title = printTitle;
          window.print();
        } finally {
          if (document.title === printTitle) document.title = previousTitle;
        }
      }
    } catch (e) { if (ticket === generation.current) setError((e as Error).message || "Document could not be prepared. Please retry."); }
    finally { preparing.current = false; document.body.classList.remove("printingSupplyDocument"); if (ticket === generation.current) { setPrinting(null); setBusy(false); } }
  }
  const term = query.trim().toLowerCase();
  const shown = records.filter(record => (kind === "ALL" || record.kind === kind) && `${record.reference} ${record.supplierName} ${record.status}`.toLowerCase().includes(term));
  return <>
    <div className="cardHead documentToolbar"><div><p className="eyebrow">Inventory & procurement</p><h1>Supply documents</h1><p>Review and print purchase orders and posted goods receipt notes.</p></div><button disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>Refresh documents</button></div>
    {error && <div className="alert" role="alert">{error}</div>}
    {loading ? <p role="status">Loading supply documents…</p> : <section className="card noPrint">
      <div className="dataForm"><label>Document type<select disabled={busy} value={kind} onChange={event => { setKind(event.target.value); setActive(null); }}><option value="ALL">All documents</option><option value="PURCHASE_ORDER">Purchase orders</option><option value="GOODS_RECEIPT">Goods receipt notes</option></select></label><label>Search documents<input disabled={busy} type="search" value={query} onChange={event => { setQuery(event.target.value); setActive(null); }} placeholder="Reference, supplier or status" /></label></div>
      <p>Latest 100 documents of each type.{truncated && " Older records are outside this view."} Receipt notes are available for deliveries posted after this feature was enabled. Historical stock movements remain in Movement history.</p>
      <div className="queue supplyDocumentList">{shown.map(record => <article className="row" key={`${record.kind}:${record.id}`}><span className="dot" /><div><strong>{record.reference}</strong><small>{record.kind === "GOODS_RECEIPT" ? "Goods receipt" : "Purchase order"} · {record.supplierName} · {record.status.replaceAll("_", " ")}</small><small>{when(record.date)} EAT</small></div><button className="secondary" disabled={busy} aria-pressed={active?.index.id === record.id && active.index.kind === record.kind} onClick={() => void prepare(record, "PREVIEW")} aria-label={`View ${record.reference}`}>View document</button></article>)}</div>
      {!shown.length && <p role="status">No supply documents match this view.</p>}
    </section>}
    {busy && <p role="status">Preparing document…</p>}
    {active && <><div className="cardHead documentToolbar noPrint"><p>Review the current document before printing.</p><button disabled={busy} onClick={() => void prepare(active.index, "PRINT")}>Print / Save PDF</button></div><SupplyDocumentPaper record={active.document} /></>}
    {printing && createPortal(<div id="supply-document-print"><SupplyDocumentPaper record={printing} /></div>, document.body)}
  </>;
}
