"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type BatchAllocation = { id: string; batchNumber: string; expiryDate: string; quantity: number; quantityAvailable: number; daysToExpiry?: number };
type StockBatch = Omit<BatchAllocation, "quantity">;
type CatalogReference = { id: string; code: string; name: string };
type MedicineChoice = CatalogReference & { available: number };
type StockPreview = {
  outstanding: number;
  available: number;
  allocation: BatchAllocation[];
  standardAllocation: BatchAllocation[];
  batches: StockBatch[];
  fefoOverridden: boolean;
  substitutionRequired: boolean;
  prescribedCatalogItem: CatalogReference;
  selectedCatalogItem: CatalogReference;
  medicines: MedicineChoice[];
};
type DispensingChoice = {
  action?: "DISPENSE" | "NOT_DISPENSED";
  quantity?: number;
  catalogItemId?: string;
  preferredBatchId?: string;
};

type Prescription = {
  medicineCode: string; genericName?: string | null; strength?: string | null; dosageForm?: string | null; dose: string; route: string; frequency: string; duration?: string | null;
  startDate?: string; stopDate?: string | null; doseTiming?: string;
  quantity: string; instructions?: string | null; dispensedQuantity?: string | null;
  dispenseStatus: string; dispenseNotes?: string | null; dispensedAt?: string | null;
  dispensedBy?: { displayName: string } | null;
  counsellingCompleted?: boolean; stockMovements?: { id: string; quantity: string; batch: { batchNumber: string; expiryDate: string } }[];
  dispensations?: { id: string; status: string; quantity: string; substitutionReason?: string | null; fefoOverrideReason?: string | null; catalogItem?: { code: string; name: string } | null; items: { quantity: string; batch: { batchNumber: string; expiryDate: string } }[] }[];
};
type Order = { id: string; type: string; status: string; priority?: string; requestedAt?: string; displayName: string; clinicalIndication?: string | null; orderedBy?: { displayName: string }; prescription?: Prescription | null };
type Visit = {
  id: string; visitNumber: string; priority: string; status: string; arrivedAt: string;
  patient: { fullName: string; patientNumber: string; sexAtBirth?: string; dateOfBirth?: string | null; estimatedAgeYears?: number | null; allergies?: { substance: string; reaction?: string | null; severity?: string | null }[] };
  triage?: { observations: { code: string; valueDecimal?: string | null; unit?: string | null }[] } | null;
  encounters?: { diagnoses: { code?: string | null; description: string; primary: boolean }[] }[];
  invoice?: { status: string; items: { quantity: string; unitPrice: string }[]; payments: { amount: string; status: string }[] } | null;
  orders?: Order[];
};

async function post(id: string, body: unknown) {
  return jsonRequest<{ allocations: BatchAllocation[]; remainingOrders: number; remainingQuantity: number; dispenseStatus: string; replayed?: boolean; substituted?: boolean; fefoOverridden?: boolean; dispensedMedicine?: { id: string; code: string; name: string } | null }>(`/api/orders/${id}/dispense`, { method: "POST", body: JSON.stringify(body) }, "Dispensing could not be recorded");
}

export function dispensingCompletionCopy(input: {
  isDispensing: boolean;
  loading: boolean;
  remaining: number;
}) {
  if (!input.isDispensing)
    return { message: "No stock will be deducted; record the reason for not supplying.", action: "Record not supplied" };
  if (input.loading)
    return { message: "Confirming live stock and the FEFO allocation…", action: "Confirm dispensing" };
  if (input.remaining > 0)
    return { message: `${input.remaining} will remain on this prescription and in the partial-supply queue.`, action: "Confirm partial supply" };
  return { message: "This quantity completes the outstanding prescription.", action: "Confirm full supply" };
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
  const [stockLoading, setStockLoading] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, DispensingChoice>>({});
  const requestKeys = useRef<Record<string, string>>({});
  const stockRequestIds = useRef<Record<string, number>>({});
  const [label, setLabel] = useState<{ patient: string; medicine: string; directions: string; batches: string } | null>(null);
  const prescriptions = active?.orders?.filter(o => o.type === "MEDICATION" && o.prescription && ["REQUESTED", "IN_PROGRESS"].includes(o.status)) || [];
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = medicationVisits.find(item => item.id === initialVisitId);
    if (visit) { setActive(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, medicationVisits, onInitialVisitOpened]);

  useEffect(() => {
    if (!active) return;
    const refreshed = visits.find(visit => visit.id === active.id);
    if (refreshed) setActive(refreshed);
  }, [visits]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStock(orderId: string, choice: DispensingChoice = {}) {
    const requestId = (stockRequestIds.current[orderId] || 0) + 1;
    stockRequestIds.current[orderId] = requestId;
    setStockLoading(current => ({ ...current, [orderId]: true }));
    setStock(current => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    try {
      const search = new URLSearchParams();
      if (choice.quantity && Number.isFinite(choice.quantity)) search.set("quantity", String(choice.quantity));
      if (choice.catalogItemId) search.set("catalogItemId", choice.catalogItemId);
      if (choice.preferredBatchId) search.set("preferredBatchId", choice.preferredBatchId);
      const response = await fetch(`/api/orders/${orderId}/dispense${search.size ? `?${search}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Batch availability could not be loaded");
      if (stockRequestIds.current[orderId] !== requestId) return;
      setStock(current => ({ ...current, [orderId]: data }));
    } finally {
      if (stockRequestIds.current[orderId] === requestId)
        setStockLoading(current => ({ ...current, [orderId]: false }));
    }
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
      const result = await post(order.id, {
        action: form.get("action"),
        idempotencyKey,
        quantity: form.get("quantity") || undefined,
        counsellingCompleted: form.get("counsellingCompleted") === "on",
        notes: form.get("notes") || undefined,
        catalogItemId: form.get("catalogItemId") || undefined,
        preferredBatchId: form.get("preferredBatchId") || undefined,
        substitutionReason: form.get("substitutionReason") || undefined,
        fefoOverrideReason: form.get("fefoOverrideReason") || undefined,
      });
      if (result.allocations?.length) setLabel({ patient: active!.patient.fullName, medicine: result.dispensedMedicine?.name || `${order.prescription!.genericName || order.displayName}${order.prescription!.strength ? ` ${order.prescription!.strength}` : ""}`, directions: order.prescription!.instructions || `${order.prescription!.dose} · ${order.prescription!.frequency}`, batches: result.allocations.map(item => item.batchNumber).join(", ") });
      delete requestKeys.current[order.id];
      const controls = [result.substituted ? "substitution recorded" : "", result.fefoOverridden ? "FEFO override recorded" : ""].filter(Boolean).join("; ");
      setNotice(result.replayed ? "Already recorded. Stock and billing were not changed again." : result.allocations?.length ? `Dispensed ${result.dispensedMedicine?.name || "medicine"} from ${result.allocations.map(item => `${item.batchNumber} (${item.quantity})`).join(", ")}. Stock and billing are updated${controls ? `; ${controls}` : ""}.` : "Decision recorded. No stock was deducted.");
      await onUpdated();
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

  const age = active.patient.dateOfBirth ? `${Math.floor((Date.now() - new Date(active.patient.dateOfBirth).getTime()) / 31557600000)} years` : active.patient.estimatedAgeYears != null ? `About ${active.patient.estimatedAgeYears} years` : "Age not recorded";
  const weight = active.triage?.observations.find(item => item.code === "WEIGHT");
  const primaryDiagnosis = active.encounters?.[0]?.diagnoses.find(item => item.primary) || active.encounters?.[0]?.diagnoses[0];
  return <>
    <header><div><p className="eyebrow">Pharmacy workstation</p><h1>Prescription review</h1><p>Confirm the patient, clinical context, medicine, quantity and batch before supply.</p></div><button className="secondary" onClick={() => setActive(null)}>← Back to queue</button></header>
    <div className={`patientBanner ${active.priority.toLowerCase()}`} aria-label="Pharmacy patient safety banner"><div><strong>{active.patient.fullName}</strong><span>{active.patient.patientNumber} · {active.visitNumber} · {active.patient.sexAtBirth ? active.patient.sexAtBirth.replaceAll("_", " ") : "Sex not recorded"} · {age}</span></div><div><small>Weight</small><b>{weight?.valueDecimal ? `${Number(weight.valueDecimal)} ${weight.unit || "kg"}` : "Not recorded"}</b></div><div><small>Primary diagnosis</small><b>{primaryDiagnosis ? `${primaryDiagnosis.code ? `${primaryDiagnosis.code} · ` : ""}${primaryDiagnosis.description}` : "Not recorded"}</b></div><div><small>Priority</small><b>{active.priority}</b></div></div>
    {active.patient.allergies?.length ? <div className="allergyAlert"><strong>Allergy alert</strong>{active.patient.allergies.map(a => <span key={a.substance}>{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}{a.severity ? ` (${a.severity})` : ""}</span>)}</div> : <div className="privacyNotice"><strong>No active allergies recorded</strong><span>Confirm allergy status with the patient before supply.</span></div>}
    {error && <div className="alert">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}
    {!prescriptions.length && <section className="card empty"><strong>Pharmacy work complete for this patient</strong><p>The patient remains open so you can verify the result. Return to the queue when ready.</p></section>}
    <div className="queue compact">{prescriptions.map(order => {
      const prescribed = Number(order.prescription!.quantity);
      const supplied = Number(order.prescription!.dispensedQuantity || 0);
      const outstanding = Math.max(0, prescribed - supplied);
      const preview = stock[order.id];
      const loadingStock = Boolean(stockLoading[order.id]);
      const choice = choices[order.id] || {};
      const isDispensing = choice.action !== "NOT_DISPENSED";
      const supplyNow = choice.quantity ?? outstanding;
      const remainingAfterSupply = Math.max(0, outstanding - supplyNow);
      const allocated = preview?.allocation.reduce((sum, item) => sum + item.quantity, 0) || 0;
      const canConfirm = !isDispensing || (!loadingStock && Boolean(preview) && allocated >= supplyNow);
      const completion = dispensingCompletionCopy({ isDispensing, loading: loadingStock, remaining: remainingAfterSupply });
      return <form className="card dataForm" onSubmit={e => submit(e, order)} key={order.id}>
      <div className="wide"><h2>{order.prescription!.genericName || order.displayName}{order.prescription!.strength ? ` ${order.prescription!.strength}` : ""}</h2><p>{order.prescription!.dosageForm || order.prescription!.medicineCode} · {order.prescription!.dose} · {order.prescription!.route} · {order.prescription!.frequency} · {order.prescription!.duration || (order.prescription!.stopDate ? `until ${new Date(order.prescription!.stopDate).toLocaleDateString()}` : "course not defined")}</p><p><strong>Indication:</strong> {order.clinicalIndication || "Not recorded"}</p>{order.prescription!.instructions && <p><strong>Instructions:</strong> {order.prescription!.instructions}</p>}</div>
      <div className="wide privacyNotice"><strong>Order context</strong><span>Prescriber: {order.orderedBy?.displayName || "Not recorded"} · Prescribed: {order.requestedAt ? new Date(order.requestedAt).toLocaleString() : "time not recorded"} · Priority: {order.priority || active.priority} · Payer status: {active.invoice?.status || "No invoice"}</span></div>
      <label>Decision *<select name="action" value={choice.action || "DISPENSE"} onChange={(event) => setChoices(current => ({ ...current, [order.id]: { ...choice, action: event.target.value as DispensingChoice["action"] } }))}><option value="DISPENSE">Dispense medicine</option><option value="NOT_DISPENSED">Do not dispense</option></select></label>
      <label>Quantity supplied now *<input name="quantity" type="number" min="0.001" max={outstanding} step="0.001" defaultValue={outstanding} onChange={(event) => { const next = { ...choice, quantity: Number(event.target.value) }; setChoices(current => ({ ...current, [order.id]: next })); void loadStock(order.id, next).catch(x => setError(x.message)); }}/><small>Prescribed: {prescribed} · Previously supplied: {supplied} · Outstanding: {outstanding}</small></label>
      {isDispensing && <>
        <label>Medicine supplied *<select name="catalogItemId" value={choice.catalogItemId || preview?.selectedCatalogItem.id || ""} disabled={loadingStock || !preview} onChange={(event) => { const next = { ...choice, catalogItemId: event.target.value, preferredBatchId: undefined }; setChoices(current => ({ ...current, [order.id]: next })); void loadStock(order.id, next).catch(x => setError(x.message)); }}>{!preview && <option value="">Loading current stock…</option>}{preview?.medicines.map(item => <option value={item.id} key={item.id}>{item.name} · {item.available} available{item.id === preview.prescribedCatalogItem.id ? " · PRESCRIBED" : " · EQUIVALENT"}</option>)}</select><small>Only products with the same ingredient, strength and dosage form can be selected.</small></label>
        <label>Batch selection<select name="preferredBatchId" value={choice.preferredBatchId || ""} disabled={loadingStock || !preview} onChange={(event) => { const next = { ...choice, preferredBatchId: event.target.value || undefined }; setChoices(current => ({ ...current, [order.id]: next })); void loadStock(order.id, next).catch(x => setError(x.message)); }}><option value="">Automatic FEFO allocation</option>{preview?.batches.map(batch => <option value={batch.id} key={batch.id}>{batch.batchNumber} · {batch.quantityAvailable} available · exp {new Date(batch.expiryDate).toLocaleDateString()}</option>)}</select><small>Leave automatic unless there is an operational reason to use another batch first.</small></label>
        {preview?.substitutionRequired && <label className="wide">Substitution reason *<textarea name="substitutionReason" minLength={5} maxLength={500} rows={2} required placeholder={`Why ${preview.selectedCatalogItem.name} is being supplied instead of ${preview.prescribedCatalogItem.name}`}/></label>}
        <div className={`wide privacyNotice${preview?.fefoOverridden ? " warning" : ""}`} aria-live="polite"><strong>{loadingStock ? "Checking live stock…" : preview?.fefoOverridden ? "FEFO override preview" : "FEFO batch plan"}</strong><span>{loadingStock ? "Refreshing availability and the batch allocation plan." : preview?.allocation.length ? preview.allocation.map(item => `${item.batchNumber}: ${item.quantity} · exp ${new Date(item.expiryDate).toLocaleDateString()}${item.daysToExpiry != null && item.daysToExpiry <= 90 ? ` · NEAR EXPIRY (${item.daysToExpiry} days)` : ""}`).join(" · ") : preview ? "No usable stock batch is available for this quantity." : "Stock availability has not loaded."}</span>{!loadingStock && preview?.fefoOverridden && <small>Standard FEFO: {preview.standardAllocation.map(item => `${item.batchNumber} (${item.quantity})`).join(" · ")}</small>}</div>
        {preview?.fefoOverridden && <label className="wide">FEFO override reason *<textarea name="fefoOverrideReason" minLength={5} maxLength={500} rows={2} required placeholder="Document why the later-expiring batch must be used first"/></label>}
      </>}
      {order.prescription!.stockMovements?.length ? <div className="wide privacyNotice"><strong>Previously supplied batches</strong><span>{order.prescription!.stockMovements.map(item => `${item.batch.batchNumber}: ${Math.abs(Number(item.quantity))}`).join(" · ")}</span></div> : null}
      {order.prescription!.dispensations?.some(item => item.substitutionReason || item.fefoOverrideReason) ? <div className="wide privacyNotice"><strong>Previous controlled decisions</strong><span>{order.prescription!.dispensations.filter(item => item.substitutionReason || item.fefoOverrideReason).map(item => `${item.catalogItem?.name || "Supplied medicine"}${item.substitutionReason ? ` · substitution: ${item.substitutionReason}` : ""}${item.fefoOverrideReason ? ` · FEFO override: ${item.fefoOverrideReason}` : ""}`).join(" | ")}</span></div> : null}
      {isDispensing && <label className="wide"><span><input name="counsellingCompleted" type="checkbox"/> Medicine use, dose, duration, precautions and storage explained to the patient *</span></label>}
      <label className="wide">Dispensing note / reason not supplied<textarea name="notes" rows={2} placeholder="Short supply, unavailable, patient declined, counselling details…"/></label>
      <div className="wide submitBar"><span>{completion.message}</span><button className="primary" disabled={busy === order.id || !canConfirm}>{busy === order.id ? "Recording…" : completion.action}</button></div>
    </form>})}</div>
  </>;
}
