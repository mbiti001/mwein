"use client";
import { RecordFields } from "./RecordFields";
import { Button } from "./ui/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FacilityLetterhead } from "./FacilityBrand";
import { ApiRequestError, jsonRequest } from "@/lib/client-http";
import { documentDefinitions, documentKinds, type DocumentKind } from "@/lib/clinic-documents";

type DocumentRecord = {
  id: string; kind: DocumentKind; reference: string; status: string; version: number; revision: number;
  payload: Record<string, string>; context: { facilityName: string; facilityCode: string; timezone: string; patientName?: string; patientNumber?: string; visitNumber?: string };
  previousId?: string | null; correctionReason?: string | null; signedAt?: string | null; signerName?: string | null; signerRoles: string[]; signerRegistration?: string | null; contentHash?: string | null;
  previous?: { reference: string } | null;
  successor?: { id: string; status: string; reference: string } | null;
};
type VisitChoice = { id: string; visitNumber: string; arrivedAt: string; patient: { fullName: string; patientNumber: string } };
export function ClinicFormPaper({ document: record }: { document: DocumentRecord }) {
  const definition = documentDefinitions[record.kind];
  return <article className="clinicFormPaper">
    <FacilityLetterhead facilityName={record.context.facilityName} title={definition.title} reference={record.reference} badge={<strong>{record.status === "SIGNED" ? "Signed" : "Draft — not issued"}</strong>} />
    <RecordFields fields={[{ label: "Patient", value: record.context.patientName }, { label: "Patient number", value: record.context.patientNumber }, { label: "Visit number", value: record.context.visitNumber }, { label: "Revision", value: record.revision }]} />
    {record.kind === "GATE" && <p className="formUseNote">Movement authorization only. This does not certify clinical discharge or payment clearance.</p>}
    {record.kind === "DELIVERY" && <p className="formUseNote">This delivery note does not post stock movements. Record goods receipt in the stock workflow.</p>}
    <RecordFields className="savedClinicFields" fields={definition.fields.map(field => ({ label: field.label, value: record.payload[field.key], wide: field.type === "textarea" }))} />
    {record.previousId && <RecordFields fields={[{ label: "Corrects document", value: record.previous?.reference || "Retained original document" }, { label: "Correction reason", value: record.correctionReason }]} />}
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
  const [unconfirmed, setUnconfirmed] = useState<{ action: "CREATE" | "CORRECT"; method: string; body: string } | null>(null);
  const generation = useRef(0);
  const saving = useRef(false);
  const definition = documentDefinitions[kind];
  const dirty = Boolean(active && definition.fields.some(field => (values[field.key] || "") !== (active.payload[field.key] || "")));
  const locked = busy || Boolean(unconfirmed);
  useEffect(() => {
    const unsaved = dirty || Boolean(unconfirmed) || (!active && Object.values(values).some(Boolean));
    const navigation = (event: Event) => { if ((busy || unsaved) && !window.confirm("Leave this document? Unsaved changes or an unconfirmed save will need checking in the register when you return.")) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (busy || unsaved) { event.preventDefault(); event.returnValue = true; } };
    window.addEventListener("mwein:before-workspace-navigation", navigation); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("mwein:before-workspace-navigation", navigation); window.removeEventListener("beforeunload", unload); };
  }, [active, busy, dirty, unconfirmed, values]);
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
    if (saving.current || (unconfirmed && unconfirmed.action !== action)) return;
    saving.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = action === "CREATE" ? { kind, visitId: kind === "DELIVERY" ? null : visitId, payload: values, requestKey: crypto.randomUUID() } : { id: active!.id, kind, version: active!.version, action, ...(action === "SAVE" ? { payload: values } : action === "SIGN" ? { attested, registration } : { reason, requestKey: crypto.randomUUID() }) };
      const submission = unconfirmed || { action, method: action === "CREATE" ? "POST" : "PATCH", body: JSON.stringify(body) };
      if (submission.action === "CREATE" || submission.action === "CORRECT") setUnconfirmed({ ...submission, action: submission.action });
      const result = await jsonRequest<{ document: DocumentRecord }>("/api/clinic-documents", { method: submission.method, body: submission.body });
      if (!result.document?.id || !result.document.reference) throw new Error("The saved document could not be confirmed.");
      setUnconfirmed(null); open(result.document); setNotice(result.document.reference + " is saved" + (result.document.status === "SIGNED" ? " and signed." : " as a draft."));
      try { await load(); } catch { setRecords([]); setNotice(result.document.reference + " is confirmed as saved. The register refresh failed; use Refresh register. Do not create it again."); }
    } catch (e) {
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) setUnconfirmed(null);
      setError((e as Error).message);
    }
    finally { saving.current = false; setBusy(false); }
  }
  async function print() {
    setError(""); setPrinting(true);
    const originalTitle = document.title;
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#clinic-form-print img")).map(img => img.decode()));
      document.title = active!.reference + " - " + documentDefinitions[active!.kind].title;
      document.body.classList.add("printingClinicForm"); window.print();
    } catch { setError("Document could not be prepared for printing. Retry before issue."); }
    finally { document.title = originalTitle; document.body.classList.remove("printingClinicForm"); setPrinting(false); }
  }
  if (!allowed.length) return <p>No clinic-document authoring permissions are assigned to your account.</p>;
  return <>
    <header><div><p className="eyebrow">Paperless clinic documents</p><h1>Clinic forms</h1><p>Complete a draft, review it, then sign electronically. Signed documents are locked; corrections retain the original.</p></div></header>
    <section className="card noPrint clinicFormTools">
      <label>Document type<select value={kind} disabled={locked || dirty} onChange={event => { if (event.target.value === kind) return; setKind(event.target.value as DocumentKind); setRecords([]); setVisits([]); setVisitId(""); setQuery(""); open(null); }}>{allowed.map(value => <option key={value} value={value}>{documentDefinitions[value].title}</option>)}</select></label>
      <label>Find saved document by reference<input disabled={locked} value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} /></label>
      <Button variant="secondary" disabled={locked || dirty} onClick={() => open(null)}>New document</Button>
      {truncated && <p role="status">Showing the latest 100 documents. Search by reference to find older records.</p>}
      <div className="documentRegister">{records.map(record => <Button variant="secondary" aria-label={"Open " + record.reference} aria-pressed={active?.id === record.id} key={record.id} disabled={locked || dirty} onClick={() => open(record)}><span><small>Document reference</small><strong>{record.reference}</strong></span><span><small>{record.context.patientName ? "Patient" : "Record"}</small><strong>{record.context.patientName || "Facility delivery"}</strong></span><span><small>Status</small><strong>{record.status === "SIGNED" ? "Signed" : "Draft"}</strong></span><span><small>Revision</small><strong>{record.revision}</strong></span></Button>)}</div>
    </section>
    {unconfirmed && <section className="alert noPrint" role="status"><p>The save is unconfirmed. Retry the same request to recover its document number without creating another record. Keep this page open until confirmed.</p><Button variant="secondary" disabled={busy} onClick={() => void act(unconfirmed.action)}>Retry document save</Button></section>}
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
    {active?.status !== "SIGNED" && <section className="card noPrint">
      <fieldset disabled={locked} className="clinicDraftFields"><h2>{active ? "Edit saved draft" : `New ${definition.title.toLowerCase()}`}</h2>
      {!active && kind !== "DELIVERY" && <div className="dataForm"><label>Find patient visit<input value={query} onChange={event => { setQuery(event.target.value); setVisitId(""); }} placeholder="Patient name, number or visit" /></label><label>Patient visit<select value={visitId} onChange={event => setVisitId(event.target.value)}><option value="">Select a patient and visit</option>{visits.map(visit => <option key={visit.id} value={visit.id}>{visit.patient.fullName} · {visit.patient.patientNumber} · {visit.visitNumber}</option>)}</select></label></div>}
      {active?.context.patientName && <p><strong>{active.context.patientName}</strong> · {active.context.patientNumber} · {active.context.visitNumber}</p>}
      <div className="dataForm">{definition.fields.map(field => <label key={field.key} className={field.type === "textarea" ? "wide" : ""}>{field.label}{field.required ? " *" : ""}{field.type === "textarea" ? <textarea value={values[field.key] || ""} maxLength={4000} onChange={event => { setValues({ ...values, [field.key]: event.target.value }); setAttested(false); }} /> : <input type={field.type || "text"} value={values[field.key] || ""} maxLength={300} onChange={event => { setValues({ ...values, [field.key]: event.target.value }); setAttested(false); }} />}</label>)}</div>
      <div className="actions"><Button variant="primary" pending={busy} disabled={(!active && kind !== "DELIVERY" && !visitId)} onClick={() => void act(active ? "SAVE" : "CREATE")}>Save draft</Button>{active && dirty && <Button variant="secondary" disabled={busy} onClick={() => open(active)}>Discard unsaved edits</Button>}</div>
      {active && <fieldset className="documentSign"><legend>Review and sign</legend><p>Review the saved preview below. Signing records your authenticated name, role and time and locks this version.</p>{definition.clinical && <label>Your professional registration number<input value={registration} maxLength={120} onChange={event => setRegistration(event.target.value)} /></label>}<label className="documentAttestation"><input type="checkbox" checked={attested} disabled={dirty} onChange={event => setAttested(event.target.checked)} />I reviewed this saved document, confirm its accuracy and authorize its issue.</label><Button variant="primary" disabled={locked || dirty || !attested || (definition.clinical && !registration.trim())} onClick={() => void act("SIGN")}>Sign and issue document</Button>{dirty && <p>Save or discard your changes before signing.</p>}</fieldset>}
    </fieldset></section>}
    {active && <>
      <div className="actions noPrint"><Button variant="secondary" disabled={locked || dirty || printing} onClick={() => void print()}>Print / Save PDF</Button><Button variant="secondary" disabled={locked || dirty} onClick={() => void load().then(() => setNotice("Register refreshed. Open the document from the register to load its latest version.")).catch(e => setError(e.message))}>Refresh register</Button></div>
      <ClinicFormPaper document={active} />
      {active.status === "SIGNED" && !active.successor && <section className="card noPrint"><fieldset disabled={locked} className="clinicDraftFields"><h2>Correct this document</h2><p>The signed original remains unchanged. A new draft must be reviewed and signed separately.</p><label>Reason for correction<textarea value={reason} minLength={10} maxLength={500} onChange={event => setReason(event.target.value)} /></label><Button variant="secondary" disabled={busy || reason.trim().length < 10} onClick={() => void act("CORRECT")}>Create correction draft</Button></fieldset></section>}
    </>}
    {printing && active && createPortal(<div id="clinic-form-print"><ClinicFormPaper document={active} /></div>, document.body)}
  </>;
}
