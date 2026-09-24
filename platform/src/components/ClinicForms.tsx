"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FacilityLetterhead } from "./FacilityBrand";
import { jsonRequest } from "@/lib/client-http";
import { documentDefinitions, documentKinds, type DocumentKind } from "@/lib/clinic-documents";

type DocumentRecord = {
  id: string; kind: DocumentKind; reference: string; status: string; version: number; revision: number;
  payload: Record<string, string>; context: { facilityName: string; facilityCode: string; timezone: string; patientName?: string; patientNumber?: string; visitNumber?: string };
  previousId?: string | null; correctionReason?: string | null; signedAt?: string | null; signerName?: string | null; signerRoles: string[]; signerRegistration?: string | null; contentHash?: string | null;
  successor?: { id: string; status: string; reference: string } | null;
};
type VisitChoice = { id: string; visitNumber: string; arrivedAt: string; patient: { fullName: string; patientNumber: string } };
export function ClinicFormPaper({ document: record }: { document: DocumentRecord }) {
  const definition = documentDefinitions[record.kind];
  return <article className="clinicFormPaper">
    <FacilityLetterhead facilityName={record.context.facilityName} title={definition.title} reference={`${record.reference} · Revision ${record.revision}`} badge={<strong>{record.status === "SIGNED" ? "SIGNED" : "DRAFT — NOT ISSUED"}</strong>} />
    {record.context.patientName && <section className="summaryIdentity"><div><small>Patient</small><strong>{record.context.patientName}</strong><span>{record.context.patientNumber}</span></div><div><small>Visit</small><strong>{record.context.visitNumber}</strong></div></section>}
    {record.kind === "GATE" && <p className="formUseNote">Movement authorization only. This does not certify clinical discharge or payment clearance.</p>}
    {record.kind === "DELIVERY" && <p className="formUseNote">This delivery note does not post stock movements. Record goods receipt in the stock workflow.</p>}
    <div className="clinicFormFields">{definition.fields.map(field => <section key={field.key}><h2>{field.label}</h2><p className="documentValue">{record.payload[field.key] || "Not recorded"}</p></section>)}</div>
    {record.previousId && <p className="formUseNote">Correction of document {record.previousId}. Reason: {record.correctionReason}</p>}
    {record.successor && <p className="formUseNote">{record.successor.status === "SIGNED" ? "Superseded by signed revision" : "A correction draft exists; not yet signed"}: {record.successor.reference}</p>}
    {record.status === "SIGNED" ? <footer className="documentSignature"><strong>Electronically signed by {record.signerName}</strong><span>{record.signerRoles.join(" · ")}</span>{record.signerRegistration && <span>Professional registration (supplied by signer): {record.signerRegistration}</span>}<span>{new Date(record.signedAt!).toLocaleString("en-KE", { timeZone: record.context.timezone })} · {record.context.timezone}</span><small>Signed through the authenticated staff account. Document fingerprint: {record.contentHash}</small></footer> : <p className="draftStatus">Draft only. An authorized staff member must review and sign before issue.</p>}
  </article>;
}
export default function ClinicForms({ permissions }: { permissions: string[] }) {
  const allowed = documentKinds.filter(kind => permissions.includes(documentDefinitions[kind].permission));
  const [kind, setKind] = useState<DocumentKind>(allowed[0] || "SICK");
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [active, setActive] = useState<DocumentRecord | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visits, setVisits] = useState<VisitChoice[]>([]);
  const [visitId, setVisitId] = useState("");
  const [query, setQuery] = useState("");
  const [referenceQuery, setReferenceQuery] = useState("");
  const [registration, setRegistration] = useState("");
  const [attested, setAttested] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [printing, setPrinting] = useState(false);
  const generation = useRef(0);
  const definition = documentDefinitions[kind];
  const dirty = Boolean(active && definition.fields.some(field => (values[field.key] || "") !== (active.payload[field.key] || "")));
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const result = await jsonRequest<{ documents: DocumentRecord[]; truncated: boolean }>(`/api/clinic-documents?kind=${kind}&q=${encodeURIComponent(referenceQuery)}`);
    if (ticket !== generation.current) return;
    setRecords(result.documents); setTruncated(result.truncated);
  }, [kind, referenceQuery]);
  useEffect(() => { void load().catch(e => setError(e.message)); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    let cancelled = false;
    if (kind === "DELIVERY") { setVisits([]); return; }
    const timer = window.setTimeout(() => { void jsonRequest<{ visits: VisitChoice[] }>(`/api/clinic-documents?kind=${kind}&visits=1&q=${encodeURIComponent(query)}`).then(result => { if (!cancelled) setVisits(result.visits); }).catch(e => { if (!cancelled) setError(e.message); }); }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [kind, query]);
  function open(record: DocumentRecord | null) {
    setActive(record); setValues(record?.payload || {}); setAttested(false); setRegistration(""); setReason(""); setError(""); setNotice("");
  }
  async function act(action: "CREATE" | "SAVE" | "SIGN" | "CORRECT") {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = action === "CREATE" ? { kind, visitId: kind === "DELIVERY" ? null : visitId, payload: values } : { id: active!.id, kind, version: active!.version, action, ...(action === "SAVE" ? { payload: values } : action === "SIGN" ? { attested, registration } : { reason }) };
      const result = await jsonRequest<{ document: DocumentRecord }>("/api/clinic-documents", { method: action === "CREATE" ? "POST" : "PATCH", body: JSON.stringify(body) });
      open(result.document); setNotice(action === "SIGN" ? "Document signed and locked. The signed record is saved." : "Draft saved to the patient or facility record."); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function print() {
    setError(""); setPrinting(true);
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#clinic-form-print img")).map(img => img.decode()));
      document.body.classList.add("printingClinicForm"); window.print();
    } catch { setError("Document could not be prepared for printing. Retry before issue."); }
    finally { document.body.classList.remove("printingClinicForm"); setPrinting(false); }
  }
  if (!allowed.length) return <p>No clinic-document authoring permissions are assigned to your account.</p>;
  return <>
    <header><div><p className="eyebrow">Paperless clinic documents</p><h1>Clinic forms</h1><p>Complete a draft, review it, then sign electronically. Signed documents are locked; corrections retain the original.</p></div></header>
    <section className="card noPrint clinicFormTools">
      <label>Document type<select value={kind} disabled={busy || dirty} onChange={event => { setKind(event.target.value as DocumentKind); setRecords([]); setVisits([]); setVisitId(""); setQuery(""); open(null); }}>{allowed.map(value => <option key={value} value={value}>{documentDefinitions[value].title}</option>)}</select></label>
      <label>Find saved document by reference<input value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} /></label>
      <button className="secondary" disabled={busy || dirty} onClick={() => open(null)}>New document</button>
      {truncated && <p role="status">Showing the latest 100 documents. Search by reference to find older records.</p>}
      <div className="documentRegister">{records.map(record => <button className="secondary" key={record.id} disabled={busy || dirty} onClick={() => open(record)}>{record.context.patientName || "Facility delivery"} · {record.reference} · {record.status} · r{record.revision}</button>)}</div>
    </section>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
    {active?.status !== "SIGNED" && <section className="card noPrint">
      <h2>{active ? "Edit saved draft" : `New ${definition.title.toLowerCase()}`}</h2>
      {!active && kind !== "DELIVERY" && <div className="dataForm"><label>Find patient visit<input value={query} onChange={event => { setQuery(event.target.value); setVisitId(""); }} placeholder="Patient name, number or visit" /></label><label>Patient visit<select value={visitId} onChange={event => setVisitId(event.target.value)}><option value="">Select a patient and visit</option>{visits.map(visit => <option key={visit.id} value={visit.id}>{visit.patient.fullName} · {visit.patient.patientNumber} · {visit.visitNumber}</option>)}</select></label></div>}
      {active?.context.patientName && <p><strong>{active.context.patientName}</strong> · {active.context.patientNumber} · {active.context.visitNumber}</p>}
      <div className="dataForm">{definition.fields.map(field => <label key={field.key} className={field.type === "textarea" ? "wide" : ""}>{field.label}{field.required ? " *" : ""}{field.type === "textarea" ? <textarea value={values[field.key] || ""} maxLength={4000} onChange={event => { setValues({ ...values, [field.key]: event.target.value }); setAttested(false); }} /> : <input type={field.type || "text"} value={values[field.key] || ""} maxLength={300} onChange={event => { setValues({ ...values, [field.key]: event.target.value }); setAttested(false); }} />}</label>)}</div>
      <div className="actions"><button className="primary" disabled={busy || (!active && kind !== "DELIVERY" && !visitId)} onClick={() => void act(active ? "SAVE" : "CREATE")}>{busy ? "Saving…" : "Save draft"}</button>{active && dirty && <button className="secondary" onClick={() => open(active)}>Discard unsaved edits</button>}</div>
      {active && <fieldset className="documentSign"><legend>Review and sign</legend><p>Review the saved preview below. Signing records your authenticated name, role and time and locks this version.</p>{definition.clinical && <label>Your professional registration number<input value={registration} maxLength={120} onChange={event => setRegistration(event.target.value)} /></label>}<label className="documentAttestation"><input type="checkbox" checked={attested} disabled={dirty} onChange={event => setAttested(event.target.checked)} />I reviewed this saved document, confirm its accuracy and authorize its issue.</label><button className="primary" disabled={busy || dirty || !attested || (definition.clinical && !registration.trim())} onClick={() => void act("SIGN")}>Sign and issue document</button>{dirty && <p>Save or discard your changes before signing.</p>}</fieldset>}
    </section>}
    {active && <>
      <div className="actions noPrint"><button className="secondary" disabled={busy || dirty || printing} onClick={() => void print()}>Print / Save PDF</button><button className="secondary" disabled={busy || dirty} onClick={() => void load().then(() => setNotice("Register refreshed. Open the document from the register to load its latest version.")).catch(e => setError(e.message))}>Refresh register</button></div>
      <ClinicFormPaper document={active} />
      {active.status === "SIGNED" && !active.successor && <section className="card noPrint"><h2>Correct this document</h2><p>The signed original remains unchanged. A new draft must be reviewed and signed separately.</p><label>Reason for correction<textarea value={reason} minLength={10} maxLength={500} onChange={event => setReason(event.target.value)} /></label><button className="secondary" disabled={busy || reason.trim().length < 10} onClick={() => void act("CORRECT")}>Create correction draft</button></section>}
    </>}
    {printing && active && createPortal(<div id="clinic-form-print"><ClinicFormPaper document={active} /></div>, document.body)}
  </>;
}
