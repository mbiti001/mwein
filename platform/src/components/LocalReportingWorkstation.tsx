"use client";

import { FormEvent, useEffect, useState } from "react";

type Payload = { sourceReference: string; zeroConfirmed: boolean; rows: { indicator: string; count: number | null }[] };
type Revision = {
  id: string; familyId: string; revision: number; version: number; month: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED"; payload: Payload; payloadHash: string;
  preparedBy: { displayName: string }; reviewedBy: { displayName: string } | null;
  reviewedAt: string | null; reviewNote: string | null; correctionReason: string | null;
  previousId: string | null; successor: { id: string } | null;
};
const initialPayload = (): Payload => ({ sourceReference: "", zeroConfirmed: false, rows: [{ indicator: "", count: null }] });
async function requestReports(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.reason || data.error || "Report request failed");
  return data;
}

export default function LocalReportingWorkstation({ permissions }: { permissions: string[] }) {
  const canPrepare = permissions.includes("reports.prepare");
  const canReview = permissions.includes("reports.review");
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 7));
  const [reports, setReports] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [payload, setPayload] = useState<Payload>(initialPayload);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const editable = canPrepare && (!selected || selected.status === "DRAFT");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    requestReports(`/api/reports/local?month=${encodeURIComponent(month)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setReports(data.reports); setTruncated(data.truncated); } })
      .catch(reason => { if (!controller.signal.aborted) { setReports([]); setError((reason as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, refresh]);

  function select(report: Revision | null) {
    setSelected(report); setPayload(report ? structuredClone(report.payload) : initialPayload()); setReason(""); setError(""); setMessage("");
  }
  const unsaved = selected && JSON.stringify(payload) !== JSON.stringify(selected.payload);
  async function mutate(action: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = selected ? { id: selected.id, version: selected.version, action, reason, ...(action === "SAVE" ? { payload } : {}) } : { month, payload };
      const data = await requestReports("/api/reports/local", { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      select(data.report); setRefresh(value => value + 1);
      setMessage(action === "APPROVE" ? "Local revision approved and frozen. Nothing has been submitted to the county or KHIS." : "Local report saved. Nothing has been submitted externally.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate("SAVE"); }

  return <section className="card localReporting" aria-labelledby="local-report-heading">
    <div className="cardHead"><div><h2 id="local-report-heading">Local reporting drafts</h2><p>Prepare aggregate counts, review them and retain corrections. Approved national datasets and county submission are not configured.</p></div></div>
    <p className="notice">Local aggregate worksheet · Not an approved MOH or IDSR return. Enter aggregate counts and a source reference, never patient names or identifiers.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
    <div className="reportFilters">
      <label>Local reporting month<input type="month" value={month} min="2000-01" max="2099-12" disabled={busy} onChange={event => { if (event.target.value) { setMonth(event.target.value); select(null); setReports([]); } }} /></label>
      <button type="button" className="secondary" disabled={busy || loading} onClick={() => { select(null); setRefresh(value => value + 1); }}>Refresh reports</button>
      {canPrepare && <button type="button" className="secondary" disabled={busy} onClick={() => select(null)}>New local draft</button>}
    </div>
    {loading ? <p role="status">Loading local reports…</p> : <div className="queue compact">{reports.map(report => <button type="button" className="row" disabled={busy} key={report.id} onClick={() => select(report)} aria-pressed={selected?.id === report.id}>
      <span>{report.payload.sourceReference} · Revision {report.revision} · {report.status.replaceAll("_", " ")} · {report.preparedBy.displayName}</span>
    </button>)}{!reports.length && <p>No local drafts for this month.</p>}</div>}
    {truncated && <p role="status">Showing the 100 most recent revisions for this month. Older records remain stored.</p>}
    {(selected || canPrepare) && <form onSubmit={save}>
      <h3>{selected ? `Revision ${selected.revision} · ${selected.status.replaceAll("_", " ")}` : "New aggregate draft"}</h3>
      <fieldset disabled={!editable || busy}>
        <legend>Aggregate worksheet</legend>
        <label>Source reference<input required minLength={3} maxLength={300} value={payload.sourceReference} onChange={event => setPayload({ ...payload, sourceReference: event.target.value })} placeholder="Register or reconciliation reference" /></label>
        {payload.rows.map((row, index) => <div className="reportFilters" key={index}>
          <label>Indicator {index + 1}<input required minLength={2} maxLength={100} value={row.indicator} onChange={event => setPayload({ ...payload, rows: payload.rows.map((item, i) => i === index ? { ...item, indicator: event.target.value } : item) })} /></label>
          <label>Count {index + 1}<input type="number" min={0} max={100000000} step={1} value={row.count ?? ""} placeholder="Missing" onChange={event => setPayload({ ...payload, zeroConfirmed: false, rows: payload.rows.map((item, i) => i === index ? { ...item, count: event.target.value === "" ? null : Number(event.target.value) } : item) })} /></label>
          <button type="button" className="secondary" disabled={payload.rows.length === 1} onClick={() => setPayload({ ...payload, zeroConfirmed: false, rows: payload.rows.filter((_, i) => i !== index) })}>Remove indicator {index + 1}</button>
        </div>)}
        <button type="button" className="secondary" disabled={payload.rows.length >= 40} onClick={() => setPayload({ ...payload, zeroConfirmed: false, rows: [...payload.rows, { indicator: "", count: null }] })}>Add indicator</button>
        <label><input type="checkbox" checked={payload.zeroConfirmed} onChange={event => setPayload({ ...payload, zeroConfirmed: event.target.checked })} />I confirm every entered indicator is explicitly zero activity.</label>
      </fieldset>
      <p>Blank counts mean missing data. Resolve missing counts before requesting review.</p>
      {selected && <label>Reason or review note<input value={reason} minLength={3} maxLength={500} required disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Explain the change or review, without patient details" /></label>}
      <div className="actions noPrint">
        {editable && <button className="primary" disabled={busy}>{selected ? "Save draft changes" : "Save local draft"}</button>}
        {selected?.status === "DRAFT" && canPrepare && <button type="button" className="secondary" disabled={busy || !!unsaved || reason.trim().length < 3} onClick={() => void mutate("REQUEST_REVIEW")}>Request review</button>}
        {selected?.status === "IN_REVIEW" && canReview && <><button type="button" className="secondary" disabled={busy || reason.trim().length < 3} onClick={() => void mutate("RETURN")}>Return for correction</button><button type="button" className="primary" disabled={busy || reason.trim().length < 3} onClick={() => void mutate("APPROVE")}>Approve local revision</button></>}
        {selected?.status === "APPROVED" && canPrepare && !selected.successor && <button type="button" className="secondary" disabled={busy || reason.trim().length < 3} onClick={() => void mutate("CORRECT")}>Create correction revision</button>}
      </div>
      {unsaved && <p>Save changes before requesting review.</p>}
      {selected && <div><p>Prepared by {selected.preparedBy.displayName}. {selected.reviewedBy && `Reviewed by ${selected.reviewedBy.displayName}.`}</p>{selected.reviewNote && <p>Review note: {selected.reviewNote}</p>}{selected.correctionReason && <p>Correction reason: {selected.correctionReason}</p>}<p>{selected.previousId ? "Linked to a previous approved revision." : "Original revision."} {selected.successor && "A correction revision exists; select it from the list."}</p><details><summary>Integrity reference</summary><p style={{ overflowWrap: "anywhere" }}>SHA-256: {selected.payloadHash}</p></details></div>}
      {selected?.status === "IN_REVIEW" && <p>Approval requires a reviewer who did not prepare this revision. Return it to draft before editing.</p>}
    </form>}
  </section>;
}
