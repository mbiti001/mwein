"use client";

import { FormEvent, useMemo, useState } from "react";

type Prescription = {
  medicineCode: string; dose: string; route: string; frequency: string; duration: string;
  quantity: string; instructions?: string | null; dispensedQuantity?: string | null;
  dispenseStatus: string; dispenseNotes?: string | null; dispensedAt?: string | null;
  dispensedBy?: { displayName: string } | null;
};
type Order = { id: string; type: string; status: string; displayName: string; prescription?: Prescription | null };
type Visit = {
  id: string; visitNumber: string; priority: string; status: string; arrivedAt: string;
  patient: { fullName: string; patientNumber: string; allergies?: { substance: string; reaction?: string | null; severity?: string | null }[] };
  orders?: Order[];
};

async function post(id: string, body: unknown) {
  const response = await fetch(`/api/orders/${id}/dispense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Dispensing could not be recorded");
}

export default function PharmacyWorkstation({ visits, onUpdated }: { visits: Visit[]; onUpdated: () => Promise<void> }) {
  const queue = useMemo(() => visits.filter(v => v.orders?.some(o => o.type === "MEDICATION" && ["REQUESTED", "IN_PROGRESS"].includes(o.status))), [visits]);
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const prescriptions = active?.orders?.filter(o => o.type === "MEDICATION" && o.prescription) || [];

  async function submit(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault(); setError(""); setBusy(order.id);
    const form = new FormData(event.currentTarget);
    try {
      await post(order.id, { action: form.get("action"), quantity: form.get("quantity") || undefined, notes: form.get("notes") || undefined });
      await onUpdated();
      setActive(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  if (!active) return <>
    <header><div><p className="eyebrow">Pharmacy workstation</p><h1>Medicines awaiting dispensing</h1><p>Review the prescription and allergies, then record what was actually supplied.</p></div></header>
    <section className="card">{queue.length ? <div className="queue">{queue.map(v => <button className={`row ${v.priority.toLowerCase()}`} onClick={() => setActive(v)} key={v.id}>
      <span className="dot"/><div><strong>{v.patient.fullName}</strong><small>{v.patient.patientNumber} · {v.visitNumber} · {v.orders?.filter(o => o.type === "MEDICATION" && ["REQUESTED", "IN_PROGRESS"].includes(o.status)).length} medicine(s)</small></div><b>{v.priority}</b><time>{new Date(v.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
    </button>)}</div> : <div className="empty"><strong>No prescriptions awaiting pharmacy</strong><p>Submitted prescriptions will appear here automatically.</p></div>}</section>
  </>;

  return <>
    <header><div><p className="eyebrow">Prescription review</p><h1>{active.patient.fullName}</h1><p>{active.patient.patientNumber} · {active.visitNumber}</p></div><button className="secondary" onClick={() => setActive(null)}>← Back to queue</button></header>
    {active.patient.allergies?.length ? <div className="allergyAlert"><strong>Allergy alert</strong>{active.patient.allergies.map(a => <span key={a.substance}>{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}{a.severity ? ` (${a.severity})` : ""}</span>)}</div> : <div className="privacyNotice"><strong>No active allergies recorded</strong><span>Confirm allergy status with the patient before supply.</span></div>}
    {error && <div className="alert">{error}</div>}
    <div className="queue compact">{prescriptions.map(order => {
      const prescribed = Number(order.prescription!.quantity);
      const supplied = Number(order.prescription!.dispensedQuantity || 0);
      const outstanding = Math.max(0, prescribed - supplied);
      return <form className="card dataForm" onSubmit={e => submit(e, order)} key={order.id}>
      <div className="wide"><h2>{order.displayName}</h2><p>{order.prescription!.medicineCode} · {order.prescription!.dose} · {order.prescription!.route} · {order.prescription!.frequency} · {order.prescription!.duration}</p>{order.prescription!.instructions && <p><strong>Instructions:</strong> {order.prescription!.instructions}</p>}</div>
      <label>Decision *<select name="action" defaultValue="DISPENSE"><option value="DISPENSE">Dispense medicine</option><option value="NOT_DISPENSED">Do not dispense</option></select></label>
      <label>Quantity supplied now *<input name="quantity" type="number" min="0.001" max={outstanding} step="0.001" defaultValue={outstanding}/><small>Prescribed: {prescribed} · Previously supplied: {supplied} · Outstanding: {outstanding}</small></label>
      <label className="wide">Dispensing note / reason not supplied<textarea name="notes" rows={2} placeholder="Short supply, unavailable, patient declined, counselling details…"/></label>
      <div className="wide submitBar"><span>A partial supply remains on this prescription and in the pharmacy queue.</span><button className="primary" disabled={busy === order.id}>{busy === order.id ? "Recording…" : "Confirm dispensing"}</button></div>
    </form>})}</div>
  </>;
}
