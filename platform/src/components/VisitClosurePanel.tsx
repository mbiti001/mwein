"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { jsonRequest } from "@/lib/client-http";
import { useWorklist } from "@/lib/use-worklist";
import { visitDispositionOptions } from "@/lib/visit-disposition";
import { RecordFields } from "./RecordFields";
import { Button } from "./ui/Button";

type Visit = { id: string; visitNumber: string; status: string; clinicallyClosedAt?: string | null; patient: { fullName: string }; encounters?: { status?: string }[] };
type Review = { revision: string; closedAt: string | null; blockers: string[]; orders: { id: string; displayName: string; status: string; orderedBy: { displayName: string } }[] };
type Saved = { visit: { clinicallyClosedAt: string }; disposition: { outcome: string; details: string; recordedById: string; recordedBy?: { displayName: string } }; financialReviewRequired: boolean };
export default function VisitClosurePanel({ visits, onUpdated }: { visits: Visit[]; onUpdated: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState<{ patient: string; visit: string; result: Saved } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cancel, setCancel] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const review = useWorklist<Review>(selected ? `/api/visits/${selected}/discharge` : null);
  const eligible = visits.filter(visit => !visit.clinicallyClosedAt && !["COMPLETED", "CANCELLED", "DISCHARGED"].includes(visit.status) && visit.encounters?.some(item => ["SIGNED", "CORRECTED"].includes(item.status || "")));
  const pending = review.data?.orders.filter(order => ["DRAFT", "REQUESTED"].includes(order.status)) || [];
  useEffect(() => {
    const guard = (event: Event) => {
      if ((dirty || inFlight.current) && !window.confirm("A discharge has unsaved or unconfirmed work. Leave this review?")) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty || inFlight.current) { event.preventDefault(); event.returnValue = true; } };
    window.addEventListener("mwein:before-workspace-navigation", guard);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("mwein:before-workspace-navigation", guard); window.removeEventListener("beforeunload", unload); };
  }, [dirty]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !review.data) return;
    const form = event.currentTarget, fields = new FormData(form);
    const target = eligible.find(visit => visit.id === selected);
    if (!target) return;
    const input = { outcome: fields.get("outcome"), details: fields.get("details"), cancelPendingOrders: cancel, expectedRevision: review.data.revision };
    const fingerprint = JSON.stringify([selected, input]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await jsonRequest<Saved>(`/api/visits/${selected}/discharge`, { method: "POST", body: JSON.stringify({ ...input, requestKey: attempt.current.key }) });
      setSaved({ patient: target.patient.fullName, visit: target.visitNumber, result });
      form.reset(); setSelected(""); setCancel(false); setDirty(false); attempt.current = null;
      setNotice(`Clinical closure recorded. Financial settlement remains separate.${result.financialReviewRequired ? " Cancelled orders require billing review." : ""}`);
      try { await onUpdated(); } catch { setError("Discharge is saved. The worklist could not refresh; refresh it before choosing another visit."); }
    } catch (reason) { setError(`${(reason as Error).message} Your entries are retained. Retry unchanged to confirm an uncertain save, or reload the review if the visit changed.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="card dischargePanel"><div className="cardHead"><div><h2>Clinical discharge</h2><p>Review outstanding services, document the outcome and hand over follow-up. Billing settlement remains separate.</p></div></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {saved && <RecordFields title="Recorded discharge" fields={[
      { label: "Patient and visit", value: `${saved.patient} · ${saved.visit}` },
      { label: "Clinical outcome", value: visitDispositionOptions.find(option => option.code === saved.result.disposition.outcome)?.label || saved.result.disposition.outcome },
      { label: "Closure summary, follow-up and handover", value: saved.result.disposition.details, wide: true },
      { label: "Recorded by", value: saved.result.disposition.recordedBy?.displayName || saved.result.disposition.recordedById || "Not recorded" },
      { label: "Recorded at", value: saved.result.visit.clinicallyClosedAt ? new Date(saved.result.visit.clinicallyClosedAt).toLocaleString() : "Not recorded" },
      { label: "Next step", value: "Billing: review retained charges and cover, then complete the visit." },
    ]}/>}
    {!eligible.length ? <p>No signed visits awaiting clinical closure.</p> : <form className="dataForm noPrint" onSubmit={submit} onChange={event => { const target = event.target as HTMLElement; if (target.getAttribute("name") !== "visitId") setDirty(true); }}>
      <label>Patient and visit<select name="visitId" required disabled={busy} value={selected} onChange={event => {
        if (selected && dirty && !window.confirm("Discard this unsaved discharge and review another visit?")) return;
        const next = event.target.value; event.currentTarget.form?.reset(); setSelected(next); setCancel(false); setDirty(false); attempt.current = null; setError("");
      }}><option value="" disabled>Select the patient to discharge</option>{eligible.map(visit => <option key={visit.id} value={visit.id}>{visit.patient.fullName} · {visit.visitNumber} · {visit.status}</option>)}</select></label>
      <label>Clinical outcome<select name="outcome" required disabled={busy} defaultValue=""><option value="" disabled>Select an outcome</option>{visitDispositionOptions.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
      {selected && <div className="wide dischargeReview">
        <h3>Discharge review</h3>
        {review.loading && <p>Loading current services…</p>}{review.error && <p role="alert">{review.error}</p>}
        <Button variant="secondary" type="button" disabled={busy || review.loading} onClick={() => void review.refresh()}>Reload discharge review</Button>
        {review.data && <><p>{review.data.orders.length ? "Saved service orders and their current status:" : "No service orders recorded."}</p>
          {review.data.orders.map(order => <RecordFields key={order.id} fields={[{ label: "Service", value: order.displayName }, { label: "Status", value: order.status.replaceAll("_", " ") }, { label: "Ordered by", value: order.orderedBy?.displayName || "Not recorded" }]}/>)}
          {review.data.blockers.map(blocker => <p role="alert" key={blocker}>{blocker}</p>)}
          {!review.data.blockers.length && <p>{pending.length ? `${pending.length} unstarted order(s) require completion or explicit cancellation with a handover plan.` : "Services resolved. Record the clinical outcome and follow-up below."}</p>}
        </>}
      </div>}
      <label className="wide">Closure summary, follow-up and handover<textarea name="details" required minLength={10} maxLength={2000} disabled={busy} /></label>
      <label className="wide closureCancellation"><input type="checkbox" name="cancelPendingOrders" checked={cancel} disabled={busy} onChange={event => setCancel(event.target.checked)} /><span>Explicitly cancel unstarted orders. Explain why above; in-progress services must first be resolved. Financial records are retained.</span></label>
      <button className="primary" disabled={busy || !review.data || review.loading || Boolean(review.data.blockers.length) || (pending.length > 0 && !cancel)}>{busy ? "Recording…" : "Confirm clinical discharge"}</button>
    </form>}
  </section>;
}
