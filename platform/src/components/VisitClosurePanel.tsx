"use client";
import { useState, type FormEvent } from "react";
import { jsonRequest } from "@/lib/client-http";
import { visitDispositionOptions } from "@/lib/visit-disposition";

type Visit = { id: string; visitNumber: string; status: string; clinicallyClosedAt?: string | null; patient: { fullName: string }; encounters?: { status?: string }[] };
export default function VisitClosurePanel({ visits, onUpdated }: { visits: Visit[]; onUpdated: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = visits.filter(visit => !visit.clinicallyClosedAt && !["COMPLETED", "CANCELLED", "DISCHARGED"].includes(visit.status) && visit.encounters?.some(item => ["SIGNED", "CORRECTED"].includes(item.status || "")));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await jsonRequest<{ financialReviewRequired: boolean }>(`/api/visits/${fields.get("visitId")}/discharge`, { method: "POST", body: JSON.stringify({ outcome: fields.get("outcome"), details: fields.get("details"), cancelPendingOrders: fields.get("cancelPendingOrders") === "on" }) });
      form.reset(); setNotice(`Clinical closure recorded. Financial settlement remains separate.${result.financialReviewRequired ? " Cancelled orders require billing review." : ""}`); await onUpdated();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  return <section className="card"><div className="cardHead"><div><h2>Clinical discharge</h2><p>Close a signed visit with an explicit outcome. This does not settle or void the invoice.</p></div></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!eligible.length ? <p>No signed visits awaiting clinical closure.</p> : <form className="dataForm" onSubmit={submit}>
      <label>Patient and visit<select name="visitId" required defaultValue=""><option value="" disabled>Select the patient to discharge</option>{eligible.map(visit => <option key={visit.id} value={visit.id}>{visit.patient.fullName} · {visit.visitNumber} · {visit.status}</option>)}</select></label>
      <label>Clinical outcome<select name="outcome" required defaultValue=""><option value="" disabled>Select an outcome</option>{visitDispositionOptions.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      <label className="wide">Closure summary, follow-up and handover<textarea name="details" required minLength={10} maxLength={2000} /></label>
      <label className="wide"><span><input type="checkbox" name="cancelPendingOrders" /> Explicitly cancel unstarted orders. Explain why above; in-progress services must first be resolved. Financial records are retained.</span></label>
      <button className="primary" disabled={busy}>{busy ? "Recording…" : "Confirm clinical discharge"}</button>
    </form>}
  </section>;
}
