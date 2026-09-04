"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type BatchAllocation = { id: string; batchNumber: string; expiryDate: string; quantity: number; quantityAvailable: number; daysToExpiry?: number };
type StockPreview = { outstanding: number; available: number; allocation: BatchAllocation[] };

type Prescription = {
  medicineCode: string; genericName?: string | null; strength?: string | null; dosageForm?: string | null; dose: string; route: string; frequency: string; duration?: string | null;
  startDate?: string; stopDate?: string | null; isPrn?: boolean; prnIndication?: string | null; doseTiming?: string;
  quantity: string; instructions?: string | null; dispensedQuantity?: string | null;
  dispenseStatus: string; dispenseNotes?: string | null; dispensedAt?: string | null;
  dispensedBy?: { displayName: string } | null;
  counsellingCompleted?: boolean; stockMovements?: { id: string; quantity: string; batch: { batchNumber: string; expiryDate: string } }[];
};
type Order = { id: string; type: string; status: string; priority?: string; requestedAt?: string; displayName: string; clinicalIndication?: string | null; orderedBy?: { displayName: string }; prescription?: Prescription | null };
type Visit = {
  id: string; visitNumber: string; priority: string; status: string; arrivedAt: string;
  patient: { fullName: string; patientNumber: string; dateOfBirth?: string | null; estimatedAgeYears?: number | null; allergies?: { substance: string; reaction?: string | null; severity?: string | null }[] };
  triage?: { observations: { code: string; valueDecimal?: string | null; unit?: string | null }[] } | null;
  invoice?: { status: string; items: { quantity: string; unitPrice: string }[]; payments: { amount: string; status: string }[] } | null;
  orders?: Order[];
};

async function post(id: string, body: unknown) {
  return jsonRequest<{ allocations: BatchAllocation[]; replayed?: boolean }>(`/api/orders/${id}/dispense`, { method: "POST", body: JSON.stringify(body) }, "Dispensing could not be recorded");
}

export default function PharmacyWorkstation({ visits, onUpdated, initialVisitId, onInitialVisitOpened }: { visits: Visit[]; onUpdated: () => Promise<void>; initialVisitId?: string | null; onInitialVisitOpened?: () => void }) {
  const [tab, setTab] = useState<"AWAITING" | "PARTIAL" | "DISPENSED" | "CLARIFICATION">("AWAITING");
  const medicationVisits = useMemo(() => visits.filter(v => v.orders?.some(o => o.type === "MEDICATION" && o.prescription)), [visits]);
  const matchesTab = (order: Order) => order.type === "MEDICATION" && !!order.prescription && (tab === "AWAITING" ? order.status === "REQUESTED" && order.prescription.dispenseStatus === "PENDING" : tab === "PARTIAL" ? order.prescription.dispenseStatus === "PARTIALLY_DISPENSED" : tab === "DISPENSED" ? order.prescription.dispenseStatus === "DISPENSED" : order.prescription.dispenseStatus === "NOT_DISPENSED");
  const queue = useMemo(() => medicationVisits.filter(v => v.orders?.some(matchesTab)), [medicationVisits, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [stock, setStock] = useState<Record<string, StockPreview>>({});
  const requestKeys = useRef<Record<string, string>>({});
  const [label, setLabel] = useState<{ patient: string; medicine: string; directions: string; batches: string } | null>(null);
  const prescriptions = active?.orders?.filter(o => o.type === "MEDICATION" && o.prescription && ["REQUESTED", "IN_PROGRESS"].includes(o.status)) || [];
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = medicationVisits.find(item => item.id === initialVisitId);
    if (visit) { setActive(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, medicationVisits, onInitialVisitOpened]);

  async function loadStock(orderId: string, quantity?: number) {
    const response = await fetch(`/api/orders/${orderId}/dispense${quantity ? `?quantity=${quantity}` : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Batch availability could not be loaded");
    setStock(current => ({ ...current, [orderId]: data }));
  }

  useEffect(() => {
    if (!active) return;
    Promise.all(prescriptions.filter(order => ["REQUESTED", "IN_PROGRESS"].includes(order.status)).map(order => loadStock(order.id))).catch(e => setError(e.message));
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(order.id);
    const form = new FormData(event.currentTarget);
    try {
      const idempotencyKey = requestKeys.current[order.id] ||= crypto.randomUUID();
      const result = await post(order.id, { action: form.get("action"), idempotencyKey, quantity: form.get("quantity") || undefined, counsellingCompleted: form.get("counsellingCompleted") === "on", notes: form.get("notes") || undefined });
      if (result.allocations?.length) setLabel({ patient: active!.patient.fullName, medicine: `${order.prescription!.genericName || order.displayName}${order.prescription!.strength ? ` ${order.prescription!.strength}` : ""}`, directions: order.prescription!.instructions || `${order.prescription!.dose} · ${order.prescription!.frequency}`, batches: result.allocations.map(item => item.batchNumber).join(", ") });
      delete requestKeys.current[order.id];
      await onUpdated();
      setActive(null);
      setNotice(result.replayed ? "This dispensing request was already recorded; stock and billing were not changed again." : result.allocations?.length ? `Dispensed from ${result.allocations.map(item => `${item.batchNumber} (${item.quantity})`).join(", ")}. Counselling confirmed and billing updated.` : "Dispensing decision recorded.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  if (!active) return <>
    <header><div><p className="eyebrow">Pharmacy workstation</p><h1>Prescription queue</h1><p>Review, supply and trace every medicine from prescription to batch and bill.</p></div></header>
    {notice && <div className="alert success">{notice}</div>}
    {label && <section className="medicineLabel card"><strong>{label.patient}</strong><h2>{label.medicine}</h2><p>{label.directions}</p><small>Batch: {label.batches} · Mwein Medical Services</small><button className="secondary noPrint" onClick={() => { document.body.classList.add("printingMedicineLabel"); window.print(); window.setTimeout(() => document.body.classList.remove("printingMedicineLabel"), 500); }}>Print medicine label</button></section>}
    <div className="pharmacyTabs" role="tablist">{(["AWAITING", "PARTIAL", "DISPENSED", "CLARIFICATION"] as const).map(value => { const count = medicationVisits.filter(v => v.orders?.some(order => order.type === "MEDICATION" && !!order.prescription && (value === "AWAITING" ? order.status === "REQUESTED" && order.prescription.dispenseStatus === "PENDING" : value === "PARTIAL" ? order.prescription.dispenseStatus === "PARTIALLY_DISPENSED" : value === "DISPENSED" ? order.prescription.dispenseStatus === "DISPENSED" : order.prescription.dispenseStatus === "NOT_DISPENSED"))).length; return <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)} key={value}>{value === "CLARIFICATION" ? "Not supplied" : value.toLowerCase().replace(/^./, letter => letter.toUpperCase())} <b>{count}</b></button>;})}</div>
    <section className="card">{queue.length ? <div className="queue">{queue.map(v => <button className={`row ${v.priority.toLowerCase()}`} onClick={() => ["AWAITING", "PARTIAL"].includes(tab) && setActive(v)} disabled={!(["AWAITING", "PARTIAL"] as string[]).includes(tab)} key={v.id}>
      <span className="dot"/><div><strong>{v.patient.fullName}</strong><small>{v.patient.patientNumber} · {v.visitNumber} · {v.orders?.filter(o => o.type === "MEDICATION" && ["REQUESTED", "IN_PROGRESS"].includes(o.status)).length} medicine(s)</small></div><b>{v.priority}</b><time>{new Date(v.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
    </button>)}</div> : <div className="empty"><strong>No prescriptions awaiting pharmacy</strong><p>Submitted prescriptions will appear here automatically.</p></div>}</section>
  </>;

  return <>
    <header><div><p className="eyebrow">Prescription review</p><h1>{active.patient.fullName}</h1><p>{active.patient.patientNumber} · {active.visitNumber} · {active.patient.dateOfBirth ? `${Math.floor((Date.now() - new Date(active.patient.dateOfBirth).getTime()) / 31557600000)} years` : active.patient.estimatedAgeYears != null ? `About ${active.patient.estimatedAgeYears} years` : "Age not recorded"} · Weight {active.triage?.observations.find(item => item.code === "WEIGHT")?.valueDecimal || "not recorded"} {active.triage?.observations.find(item => item.code === "WEIGHT")?.unit || ""}</p></div><button className="secondary" onClick={() => setActive(null)}>← Back to queue</button></header>
    {active.patient.allergies?.length ? <div className="allergyAlert"><strong>Allergy alert</strong>{active.patient.allergies.map(a => <span key={a.substance}>{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}{a.severity ? ` (${a.severity})` : ""}</span>)}</div> : <div className="privacyNotice"><strong>No active allergies recorded</strong><span>Confirm allergy status with the patient before supply.</span></div>}
    {error && <div className="alert">{error}</div>}
    <div className="queue compact">{prescriptions.map(order => {
      const prescribed = Number(order.prescription!.quantity);
      const supplied = Number(order.prescription!.dispensedQuantity || 0);
      const outstanding = Math.max(0, prescribed - supplied);
      const preview = stock[order.id];
      return <form className="card dataForm" onSubmit={e => submit(e, order)} key={order.id}>
      <div className="wide"><h2>{order.prescription!.genericName || order.displayName}{order.prescription!.strength ? ` ${order.prescription!.strength}` : ""}</h2><p>{order.prescription!.dosageForm || order.prescription!.medicineCode} · {order.prescription!.dose} · {order.prescription!.route} · {order.prescription!.frequency} · {order.prescription!.duration || (order.prescription!.stopDate ? `until ${new Date(order.prescription!.stopDate).toLocaleDateString()}` : "course not defined")}{order.prescription!.isPrn ? ` · PRN for ${order.prescription!.prnIndication}` : ""}</p><p><strong>Indication:</strong> {order.clinicalIndication || "Not recorded"}</p>{order.prescription!.instructions && <p><strong>Instructions:</strong> {order.prescription!.instructions}</p>}</div>
      <div className="wide privacyNotice"><strong>Order context</strong><span>Prescriber: {order.orderedBy?.displayName || "Not recorded"} · Prescribed: {order.requestedAt ? new Date(order.requestedAt).toLocaleString() : "time not recorded"} · Priority: {order.priority || active.priority} · Payer status: {active.invoice?.status || "No invoice"}</span></div>
      <label>Decision *<select name="action" defaultValue="DISPENSE"><option value="DISPENSE">Dispense medicine</option><option value="NOT_DISPENSED">Do not dispense</option></select></label>
      <label>Quantity supplied now *<input name="quantity" type="number" min="0.001" max={outstanding} step="0.001" defaultValue={outstanding} onChange={e => loadStock(order.id, Number(e.target.value)).catch(x => setError(x.message))}/><small>Prescribed: {prescribed} · Previously supplied: {supplied} · Outstanding: {outstanding}</small></label>
      <div className="wide privacyNotice"><strong>FEFO batch plan</strong><span>{preview?.allocation.length ? preview.allocation.map(item => `${item.batchNumber}: ${item.quantity} · exp ${new Date(item.expiryDate).toLocaleDateString()}${item.daysToExpiry != null && item.daysToExpiry <= 90 ? ` · NEAR EXPIRY (${item.daysToExpiry} days)` : ""}`).join(" · ") : "No usable stock batch available"}</span></div>
      {order.prescription!.stockMovements?.length ? <div className="wide privacyNotice"><strong>Previously supplied batches</strong><span>{order.prescription!.stockMovements.map(item => `${item.batch.batchNumber}: ${Math.abs(Number(item.quantity))}`).join(" · ")}</span></div> : null}
      <label className="wide"><span><input name="counsellingCompleted" type="checkbox"/> Medicine use, dose, duration, precautions and storage explained to the patient *</span></label>
      <label className="wide">Dispensing note / reason not supplied<textarea name="notes" rows={2} placeholder="Short supply, unavailable, patient declined, counselling details…"/></label>
      <div className="wide submitBar"><span>A partial supply remains on this prescription and in the pharmacy queue.</span><button className="primary" disabled={busy === order.id}>{busy === order.id ? "Recording…" : "Confirm dispensing"}</button></div>
    </form>})}</div>
  </>;
}
