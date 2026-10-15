"use client";

import { useEffect, useRef, useState } from "react";
import { useWorklist } from "@/lib/use-worklist";
import { jsonRequest } from "@/lib/client-http";
import InvestigationReviewPanel from "./InvestigationReviewPanel";

type ReviewEvent = { id: string; sequence: number; action: string; note: string; recordedAt: string; actor: { id: string; displayName: string } };
type Order = {
  id: string; displayName: string; type: string; status: string; priority: string; requestedAt: string; orderedBy: { displayName: string };
  visit: { id: string; visitNumber: string; status: string; clinicallyClosedAt: string | null; patient: { fullName: string; patientNumber: string } };
  diagnosticReviews: ReviewEvent[];
  laboratory: { specimenStatus: string; result: { id: string; verifiedAt: string } | null } | null;
  imaging: { result: { id: string; verifiedAt: string } | null } | null;
};
type Saved = { order: Order; actorId: string; canReview: boolean; historyTruncated: boolean };
const time = (value: string) => `${new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} EAT`;
const report = (order: Order) => order.laboratory?.result || order.imaging?.result;

export default function DiagnosticReviewWorkstation() {
  const [state, setState] = useState("ALL");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<string[]>([""]);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useWorklist<{ orders: Order[]; truncated: boolean; limit: number; nextCursor: string | null }>(
    `/api/diagnostic-reviews?state=${state}&q=${encodeURIComponent(query.trim())}&limit=25&cursor=${encodeURIComponent(pages.at(-1) || "")}`, 0, 250);
  const dirty = useRef(false);
  function leave() { return !dirty.current || window.confirm("Leave this review? Unsaved text or an unconfirmed action will need checking when you return."); }
  useEffect(() => {
    const navigation = (event: Event) => { if (!leave()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = true; } };
    window.addEventListener("mwein:before-workspace-navigation", navigation);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("mwein:before-workspace-navigation", navigation); window.removeEventListener("beforeunload", unload); };
  }, []);
  return <section className="card diagnosticReviewWorkspace" aria-label="Diagnostic review work">
    <div className="diagnosticReviewToolbar noPrint"><div><h2>Diagnostic review work</h2><p>Pending requests and released reports remain here until a clinician explicitly acknowledges review. Closed visits are included.</p></div>
      <button type="button" className="secondary" disabled={list.loading} onClick={() => void list.refresh()}>Refresh worklist</button></div>
    <div className="noPrint">
      <div className="diagnosticReviewGrid">
        <label>Report availability<select value={state} onChange={event => { setState(event.target.value); setPages([""]); }}><option value="ALL">All outstanding investigations</option><option value="RELEASED">Released reports awaiting review</option><option value="PENDING">Awaiting verified reports</option><option value="ACKNOWLEDGED">Acknowledged reports (history)</option></select></label>
        <label>Find diagnostic work<input type="search" maxLength={100} value={query} placeholder="Patient, patient number, visit or test" onChange={event => { setQuery(event.target.value); setPages([""]); }} /></label>
      </div>
      <p>Oldest requests first, 25 per page. These are review tasks, not proof of patient contact or completed care. The selected review stays open when browsing.</p>
      {list.loading && <p role="status">Loading diagnostic work…</p>}
      {list.error && <p role="alert">Worklist unavailable. {list.error} Use Refresh worklist to try again.</p>}
      <nav className="diagnosticReviewToolbar" aria-label="Diagnostic work pages">
        <button type="button" className="secondary" disabled={pages.length === 1} onClick={() => setPages([""])}>First page</button>
        <button type="button" className="secondary" disabled={pages.length === 1} onClick={() => setPages(current => current.slice(0, -1))}>Previous page</button>
        <span role="status">Page {pages.length}{list.data ? ` · ${list.data.orders.length} requests${list.data.truncated ? " · More available" : " · End of current results"}` : ""}</span>
        <button type="button" className="secondary" disabled={list.loading || !list.data?.nextCursor} onClick={() => { if (list.data?.nextCursor) setPages(current => [...current, list.data!.nextCursor!]); }}>Next page</button>
      </nav>
      <p>Results can change as staff work. Use First page to check earlier requests again; page numbers are browsing positions, not a total count.</p>
      {list.data && !list.data.orders.length && <p>No {state === "ACKNOWLEDGED" ? "acknowledged reports" : "outstanding investigations"} in this view.</p>}
      <div className="diagnosticReviewList">{list.data?.orders.map(order => <button type="button" aria-pressed={order.id === selected} className={order.id === selected ? "active" : "secondary"} key={order.id} onClick={() => { if (order.id !== selected && leave()) { dirty.current = false; setSelected(order.id); } }}>
        <strong>{order.visit.patient.fullName} · {order.visit.patient.patientNumber}</strong><span>{order.displayName} · {order.visit.visitNumber}</span>
        <span>{order.diagnosticReviews[0]?.action === "ACKNOWLEDGE" ? "Acknowledged" : report(order) ? "Released — awaiting acknowledgement" : "Awaiting verified report"} · {order.priority}</span>
        <span>Owner: {order.diagnosticReviews[0]?.actor.displayName || "Not accepted"} · Requested {time(order.requestedAt)}</span>
        {(order.visit.clinicallyClosedAt || ["COMPLETED", "CANCELLED"].includes(order.visit.status)) && <span>Closed visit{order.diagnosticReviews[0]?.action !== "ACKNOWLEDGE" ? " — review remains outstanding" : ""}</span>}
      </button>)}</div>
    </div>
    {selected && <ReviewDetail key={selected} id={selected} onDirty={value => { dirty.current = value; }} onSaved={() => void list.refresh()} />}
  </section>;
}

function ReviewDetail({ id, onDirty, onSaved }: { id: string; onDirty: (value: boolean) => void; onSaved: () => void }) {
  const saved = useWorklist<Saved>(`/api/orders/${id}/diagnostic-review`);
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  onDirty(Boolean(note || attested || pending || unconfirmed));
  const data = saved.data?.order.id === id ? saved.data : null;
  const order = data?.order, latest = order?.diagnosticReviews[0];
  const released = order ? report(order) : null;
  const mine = latest?.action === "CLAIM" && latest.actor.id === data?.actorId;
  const acknowledged = latest?.action === "ACKNOWLEDGE";
  async function submit(action: "CLAIM" | "ACKNOWLEDGE") {
    if (busy.current || !data) return;
    const body = unconfirmed || { action, expectedEventId: latest?.id || null, requestKey: crypto.randomUUID(), note,
      ...(action === "ACKNOWLEDGE" ? { resultId: released?.id, verifiedAt: released?.verifiedAt, attested } : {}) };
    busy.current = true; setPending(true); setError(""); setNotice(""); setUnconfirmed(body);
    try {
      const result = await jsonRequest<{ eventId: string; replayed: boolean }>(`/api/orders/${id}/diagnostic-review`, { method: "POST", body: JSON.stringify(body) });
      if (!mounted.current) return;
      setUnconfirmed(null); setNote(""); setAttested(false);
      setNotice(`${body.action === "CLAIM" ? "Review responsibility" : "Report acknowledgement"} confirmed as saved${result.replayed ? " from the original request" : ""}.`);
      const refreshed = await saved.refresh();
      if (!mounted.current) return;
      if (!refreshed) setNotice("The review action is confirmed as saved. The saved-record refresh failed; use Reload saved review. Do not submit it again.");
      onSaved();
    } catch (failure) {
      if (mounted.current) setError(`${(failure as Error).message} The action is unconfirmed. Retry the same action or reload the saved review before changing it.`);
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function reload() {
    if (busy.current) return;
    if ((note || attested || unconfirmed) && !window.confirm("Reload the saved review and discard this entered text or unconfirmed request? This only reads the saved record; it does not submit another action.")) return;
    setNote(""); setAttested(false); setUnconfirmed(null); setError(""); setNotice("");
    const refreshed = await saved.refresh();
    if (refreshed && mounted.current) setNotice("Saved review loaded. No action was submitted.");
  }
  return <section className="diagnosticReviewDetail" aria-label="Selected diagnostic review">
    <div className="diagnosticReviewToolbar"><h3>Saved review and responsibility</h3><button type="button" className="secondary noPrint" disabled={pending || saved.loading} onClick={() => void reload()}>Reload saved review</button></div>
    {saved.loading && <p role="status">Loading saved review…</p>}
    {saved.error && <p role="alert">Saved review unavailable. {saved.error}</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {order && <>
      <h4>{order.displayName} · {order.visit.patient.fullName} · {order.visit.patient.patientNumber}</h4>
      <div className="diagnosticReviewGrid">
        <p><strong>Requested by</strong><span>{order.orderedBy?.displayName || "Not recorded"} · {time(order.requestedAt)}</span></p>
        <p><strong>Accepted review owner</strong><span>{latest?.actor.displayName || "Not accepted"}</span></p>
        <p><strong>Review state</strong><span>{acknowledged ? "Acknowledged" : "Outstanding"} · {order.visit.visitNumber}</span></p>
        <p><strong>Report availability</strong><span>{released ? `Verified ${time(released.verifiedAt)}` : "No verified report available"}</span></p>
      </div>
      <p>Accepting responsibility or acknowledging review does not reopen the visit, contact the patient, complete treatment or replace critical-result communication.</p>
      <InvestigationReviewPanel key={order.visit.id} visitId={order.visit.id} />
      {data?.canReview && !acknowledged && order.status !== "CANCELLED" && <form className="diagnosticReviewForm noPrint" onSubmit={event => { event.preventDefault(); void submit(mine ? "ACKNOWLEDGE" : "CLAIM"); }}>
        <fieldset disabled={pending || Boolean(unconfirmed)}>
          <label>{mine ? "Review findings and next steps" : "Responsibility or handover reason"}<textarea required minLength={3} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
          {mine && <label className="diagnosticReviewAttestation"><input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} />I have read the verified report identified above and recorded my review and next steps.</label>}
        </fieldset>
        {!unconfirmed && <button type="submit" className="primary" disabled={pending || (mine && !released)}>{mine ? "Acknowledge reviewed report" : latest ? "Accept handover to me" : "Accept review responsibility"}</button>}
        {mine && !released && <p>Responsibility is recorded. A verified report is required before acknowledgement.</p>}
      </form>}
      {!data?.canReview && <p>Read-only access. A clinician with consultation permission must accept and acknowledge the review.</p>}
      {!!order.diagnosticReviews.length && <section aria-label="Diagnostic review history"><h4>Saved review history</h4>{data?.historyTruncated && <p>Showing the latest 50 events. Earlier responsibility history is retained.</p>}{order.diagnosticReviews.map(event => <article className="diagnosticReviewHistory" key={event.id}><div className="diagnosticReviewGrid"><p><strong>{event.action === "CLAIM" ? "Responsibility or handover reason" : "Review findings and next steps"}</strong><span>{event.note}</span></p><p><strong>{event.action === "CLAIM" ? "Responsibility accepted" : "Report acknowledged"}</strong><span>{event.actor.displayName} · {time(event.recordedAt)}</span></p></div></article>)}</section>}
    </>}
    {unconfirmed && <button type="button" className="primary noPrint" disabled={pending || !data} onClick={() => void submit(unconfirmed.action as "CLAIM" | "ACKNOWLEDGE")}>{pending ? "Saving review…" : "Retry same review action"}</button>}
  </section>;
}
