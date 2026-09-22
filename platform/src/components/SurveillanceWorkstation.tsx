"use client";
import { FormEvent, useEffect, useState } from "react";
import type { SurveillanceDetails } from "@/lib/surveillance";

type Entry = { id: string; version: number; action: string; reason: string; occurredAt: string; actor: { displayName: string }; snapshot: { details: SurveillanceDetails; status: string }; evidence: Record<string, string> | null };
type RecordItem = { id: string; version: number; status: string; priority: string; details: SurveillanceDetails; duplicateOfId: string | null; patient?: { fullName: string; patientNumber: string } | null; entries?: Entry[] };
type PatientOption = { id: string; fullName: string; patientNumber: string };
const emptyDetails = (): SurveillanceDetails => ({ kind: "CASE", patientId: null, concern: "", description: "", location: "", detectedAt: new Date().toISOString(), onsetAt: null, priority: "UNASSESSED" });
const localTime = (value: string) => new Date(new Date(value).getTime() + 3 * 3600000).toISOString().slice(0, 16);
const instant = (value: string) => new Date(`${value}:00+03:00`).toISOString();
const shownTime = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init); const data = await response.json();
  if (!response.ok) throw new Error(data.reason || data.error || "Request failed");
  return data;
}
export default function SurveillanceWorkstation({ permissions }: { permissions: string[] }) {
  const canRecord = permissions.includes("surveillance.record"), canReview = permissions.includes("surveillance.review");
  const [records, setRecords] = useState<RecordItem[]>([]), [selected, setSelected] = useState<RecordItem | null>(null);
  const [details, setDetails] = useState<SurveillanceDetails>(emptyDetails);
  const [status, setStatus] = useState("OPEN"), [priority, setPriority] = useState("ALL");
  const [cursor, setCursor] = useState<string | null>(null), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [query, setQuery] = useState(""), [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientLabel, setPatientLabel] = useState("");
  const [contactTime, setContactTime] = useState(() => localTime(new Date().toISOString()));
  const [recipient, setRecipient] = useState(""), [channel, setChannel] = useState("PHONE"), [outcome, setOutcome] = useState("ATTEMPTED"), [evidence, setEvidence] = useState("");
  const [entryId, setEntryId] = useState(""), [originalId, setOriginalId] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    api(`/api/surveillance?status=${status}&priority=${priority}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setRecords(data.records); setNextCursor(data.nextCursor); } })
      .catch(reason => { if (!controller.signal.aborted) { setRecords([]); setError((reason as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, priority, cursor, refresh]);
  function reset() { setSelected(null); setDetails(emptyDetails()); setReason(""); setPatientLabel(""); setPatients([]); setQuery(""); setEntryId(""); setOriginalId(""); setError(""); setMessage(""); }
  async function open(id: string) {
    const data = await api(`/api/surveillance?id=${encodeURIComponent(id)}`);
    setSelected(data.record); setDetails(data.record.details); setReason(""); setEntryId(""); setOriginalId(""); setPatients([]); setQuery("");
    setPatientLabel(data.record.patient ? `${data.record.patient.patientNumber} · ${data.record.patient.fullName}` : "");
  }
  async function select(id: string) { setBusy(true); setError(""); setMessage(""); try { await open(id); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  async function mutate(action: string, extra: object = {}) {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = selected ? { id: selected.id, version: selected.version, action, reason, ...extra } : { details };
      const data = await api("/api/surveillance", { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMessage("Saved locally. The app has not sent a notification or verified county receipt.");
      await open(data.record.id); setRefresh(value => value + 1);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); setError(""); try { setPatients((await api(`/api/patients?q=${encodeURIComponent(query)}`)).patients); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  function save(event: FormEvent) { event.preventDefault(); void mutate("UPDATE", { details }); }
  const dirty = selected && JSON.stringify(details) !== JSON.stringify(selected.details);
  const actionDisabled = busy || reason.trim().length < 3 || !!dirty;
  const editable = canRecord && selected?.status !== "CLOSED";
  return <>
    <header><div><p className="eyebrow">Local surveillance</p><h1>Local IDSR register</h1><p>Record cases and unusual events, review concerns and preserve notification history.</p></div></header>
    <p className="notice">National case definitions and county routing are not configured. This register does not submit reports or decide whether a disease is notifiable. Follow the facility’s established urgent reporting procedure without waiting for local review.</p>
    {error && <div className="alert" role="alert">{error}</div>}{message && <p role="status">{message}</p>}
    <section className="card"><div className="reportFilters">
      <label>Record status<select value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setCursor(null); }}><option>OPEN</option><option>REVIEWED</option><option>CLOSED</option><option>ALL</option></select></label>
      <label>Local priority filter<select value={priority} disabled={busy} onChange={event => { setPriority(event.target.value); setCursor(null); }}><option>ALL</option><option>URGENT</option><option>UNASSESSED</option><option>ROUTINE</option></select></label>
      <button className="secondary" disabled={busy || loading} onClick={() => { setCursor(null); setRefresh(value => value + 1); }}>Refresh register</button>
      {canRecord && <button className="primary" disabled={busy} onClick={reset}>New concern</button>}
    </div>{loading ? <p role="status">Loading register…</p> : <div className="queue compact">{records.map(record => <button className={`row ${record.priority === "URGENT" ? "urgent" : ""}`} key={record.id} disabled={busy} onClick={() => void select(record.id)} aria-pressed={record.id === selected?.id}>{record.details.concern} · {record.details.kind} · {record.priority} · {record.status}</button>)}{!records.length && <p>No concerns match these filters.</p>}</div>}
      {nextCursor && <button className="secondary" disabled={busy || loading} onClick={() => setCursor(nextCursor)}>Next records</button>}
    </section>
    {(selected || canRecord) && <section className="card"><h2>{selected ? `Concern · ${selected.status}` : "New local concern"}</h2>
      {selected && <p>Local record ID: {selected.id}{selected.duplicateOfId && ` · Duplicate of ${selected.duplicateOfId}`}</p>}
      <form onSubmit={save}><fieldset disabled={!editable || busy}><legend>Case or event details</legend>
        <div className="reportFilters"><label>Record type<select value={details.kind} onChange={event => { setDetails({ ...details, kind: event.target.value as SurveillanceDetails["kind"], patientId: null }); setPatientLabel(""); setPatients([]); }}><option value="CASE">Case concern</option><option value="EVENT">Unusual event or cluster</option></select></label>
        <label>Local priority<select value={details.priority} onChange={event => setDetails({ ...details, priority: event.target.value as SurveillanceDetails["priority"] })}><option value="UNASSESSED">Unassessed</option><option value="URGENT">Urgent — staff selected</option><option value="ROUTINE">Routine — staff selected</option></select></label></div>
        <label>Concern or suspected condition<input required minLength={3} maxLength={160} value={details.concern} onChange={event => setDetails({ ...details, concern: event.target.value })} /></label>
        <label>Observed concern<textarea required minLength={5} maxLength={3000} value={details.description} onChange={event => setDetails({ ...details, description: event.target.value })} /></label>
        <label>Location or affected area<input maxLength={300} value={details.location} onChange={event => setDetails({ ...details, location: event.target.value })} /></label>
        <div className="reportFilters"><label>Detected at (Nairobi)<input type="datetime-local" required value={localTime(details.detectedAt)} onChange={event => { if (event.target.value) setDetails({ ...details, detectedAt: instant(event.target.value) }); }} /></label>
        <label>Onset at (Nairobi, if known)<input type="datetime-local" value={details.onsetAt ? localTime(details.onsetAt) : ""} onChange={event => setDetails({ ...details, onsetAt: event.target.value ? instant(event.target.value) : null })} /></label></div>
        {details.kind === "CASE" && <div><p>{details.patientId ? `Linked patient: ${patientLabel || details.patientId}` : "No patient linked — unidentified cases may be recorded."}</p>
          <label>Find patient (optional)<input value={query} onChange={event => setQuery(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={query.trim().length < 3} onClick={() => void search()}>Search patients</button>
          {details.patientId && <button type="button" className="secondary" onClick={() => { setDetails({ ...details, patientId: null }); setPatientLabel(""); }}>Remove patient link</button>}
          {patients.map(patient => <button type="button" className="secondary" key={patient.id} onClick={() => { setDetails({ ...details, patientId: patient.id }); setPatientLabel(`${patient.patientNumber} · ${patient.fullName}`); setPatients([]); }}>{patient.patientNumber} · {patient.fullName}</button>)}
        </div>}
      </fieldset>
      {selected && <label>Change or review reason<textarea required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>}
      {editable && <button className="primary" disabled={busy}>{selected ? "Save concern changes" : "Save local concern"}</button>}
      </form>
      {dirty && <p>Save detail changes before recording another action.</p>}
      {selected && canReview && <div className="actions noPrint">
        {selected.status === "OPEN" && <button className="secondary" disabled={actionDisabled} onClick={() => void mutate("REVIEW")}>Record local review</button>}
        {selected.status === "REVIEWED" && <button className="secondary" disabled={actionDisabled} onClick={() => void mutate("CLOSE")}>Close local concern</button>}
        {selected.status === "CLOSED" && <button className="secondary" disabled={actionDisabled} onClick={() => void mutate("REOPEN")}>Reopen concern</button>}
        {selected.status !== "CLOSED" && <div><label>Original local record ID<input value={originalId} disabled={busy} onChange={event => setOriginalId(event.target.value)} /></label><button className="secondary" disabled={actionDisabled || !originalId} onClick={() => void mutate("DUPLICATE", { duplicateOfId: originalId })}>Link as duplicate</button></div>}
      </div>}
      {selected && canRecord && <details className="managementPanel"><summary>Record an external notification or acknowledgement</summary><div className="managementBody">
        <p>Record only an action already taken through the established reporting channel. No message is sent by this form. Entries and acknowledgements remain staff-reported and unverified by the receiving service.</p>
        <label>Contact time (Nairobi)<input type="datetime-local" value={contactTime} onChange={event => setContactTime(event.target.value)} disabled={busy} /></label>
        <label>Recipient or responding office<input maxLength={160} value={recipient} onChange={event => setRecipient(event.target.value)} disabled={busy} /></label>
        <label>Channel<select value={channel} onChange={event => setChannel(event.target.value)} disabled={busy}><option value="PHONE">Phone</option><option value="PAPER">Paper</option><option value="OTHER_APPROVED_CHANNEL">Other established channel</option></select></label>
        <label>Staff-reported outcome<select value={outcome} onChange={event => setOutcome(event.target.value)} disabled={busy}><option value="ATTEMPTED">Attempted; delivery not established</option><option value="REPORTED_DELIVERED">Staff reports delivery</option></select></label>
        <label>Protected evidence reference<input maxLength={500} value={evidence} onChange={event => setEvidence(event.target.value)} disabled={busy} /></label>
        <button className="secondary" disabled={actionDisabled || !contactTime || recipient.trim().length < 3 || evidence.trim().length < 3} onClick={() => void mutate("NOTIFY", { notification: { notifiedAt: instant(contactTime), recipient, channel, outcome, evidenceReference: evidence } })}>Record notification history</button>
        <label>Referenced history entry<select value={entryId} onChange={event => setEntryId(event.target.value)} disabled={busy}><option value="">Choose history entry</option>{selected.entries?.map(entry => <option key={entry.id} value={entry.id}>v{entry.version} · {entry.action} · {entry.reason.slice(0, 70)}</option>)}</select></label>
        <button className="secondary" disabled={actionDisabled || !entryId || !contactTime || recipient.trim().length < 3 || evidence.trim().length < 3} onClick={() => void mutate("ACKNOWLEDGE", { acknowledgement: { notificationId: entryId, acknowledgedAt: instant(contactTime), recipient, evidenceReference: evidence } })}>Record manual acknowledgement</button>
        <button className="secondary" disabled={actionDisabled || !entryId} onClick={() => void mutate("ANNOTATE", { entryId })}>Append correction note</button>
      </div></details>}
    </section>}
    {selected && <section className="card"><h2>Concern history</h2><p>Prior entries cannot be overwritten. Corrections are additional entries. Times are shown in Nairobi time.</p>{selected.entries?.map(entry => <details key={entry.id}><summary>v{entry.version} · {entry.action} · {shownTime(entry.occurredAt)} · {entry.actor.displayName}</summary><p>{entry.reason}</p><p>{entry.snapshot.status} · {entry.snapshot.details.priority} · {entry.snapshot.details.concern}</p><p>{entry.snapshot.details.description}</p><p>Location: {entry.snapshot.details.location || "Not recorded"} · Detected: {shownTime(entry.snapshot.details.detectedAt)} · Onset: {entry.snapshot.details.onsetAt ? shownTime(entry.snapshot.details.onsetAt) : "Unknown"}</p>{entry.evidence && <dl>{Object.entries(entry.evidence).map(([key, value]) => <div key={key}><dt>{({ notifiedAt: "Notification time", acknowledgedAt: "Acknowledgement time", recipient: "Recipient", channel: "Channel", outcome: "Staff-reported outcome", evidenceReference: "Evidence reference", assurance: "Assurance", entryId: "Corrected entry", notificationId: "Referenced notification", annotation: "Entry purpose" } as Record<string, string>)[key] || key}</dt><dd>{key.endsWith("At") ? shownTime(value) : value}</dd></div>)}</dl>}</details>)}</section>}
  </>;
}
