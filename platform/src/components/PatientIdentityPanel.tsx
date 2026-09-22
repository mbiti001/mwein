"use client";
import { useState, type FormEvent } from "react";
import { jsonRequest } from "@/lib/client-http";
type Patient = { id: string; fullName: string; patientNumber: string; identityStatus?: string };
type History = { id: string; reason: string; reconciledAt: string; reversible: boolean; reversedAt: string | null };
export default function PatientIdentityPanel({ onUpdated }: { onUpdated: () => Promise<void> }) {
  const [query, setQuery] = useState(""); const [matches, setMatches] = useState<Patient[]>([]); const [patient, setPatient] = useState<Patient | null>(null);
  const [history, setHistory] = useState<History[]>([]); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setPatient(null); setHistory([]); setError(""); setNotice("");
    try { setMatches((await jsonRequest<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query.trim())}`)).patients); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function select(item: Patient) {
    setPatient(item); setMatches([]); setHistory([]); setError(""); setBusy(true);
    try { setHistory((await jsonRequest<{ history: History[] }>(`/api/patients/${item.id}/identity-reconciliation`)).history); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!patient) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest(`/api/patients/${patient.id}/identity-reconciliation`, { method: "POST", body: JSON.stringify({ ...body, estimatedAgeYears: body.estimatedAgeYears === undefined ? undefined : Number(body.estimatedAgeYears) }) });
      setNotice("Identity history updated. Clinical records and privacy restrictions were preserved. This is not national-registry verification."); await select(patient); await onUpdated();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  return <section className="card"><details><summary><strong>Patient identity review and corrections</strong></summary><p>Find the exact patient before documenting emergency identity or correcting demographics. Conflicting identifiers are blocked; no automatic merging occurs.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={search} className="queueTools"><label>Find identity record<input value={query} minLength={2} required onChange={event => { setQuery(event.target.value); setPatient(null); setHistory([]); setMatches([]); }} /></label><button className="secondary" disabled={busy}>Search</button></form>
    {matches.map(item => <button className="patientResult" key={item.id} disabled={busy} onClick={() => void select(item)}>{item.fullName} · {item.patientNumber}</button>)}
    {patient && <><h3>{patient.fullName} · {patient.patientNumber}</h3><form key={patient.id} className="dataForm" onSubmit={submit}>
      <label>Given name<input name="givenName" required /></label><label>Middle name<input name="middleName" /></label><label>Family name<input name="familyName" required /></label>
      <label>Date of birth<input name="dateOfBirth" type="date" /></label><label>Or estimated age<input name="estimatedAgeYears" type="number" min="0" max="130" /></label>
      <label>Sex at birth<select name="sexAtBirth" defaultValue="UNKNOWN"><option>UNKNOWN</option><option>FEMALE</option><option>MALE</option><option>INTERSEX</option></select></label>
      <label>Identifier type<select name="identifierType"><option>NATIONAL_ID</option><option>SHA</option><option>BIRTH_CERTIFICATE</option><option>PASSPORT</option><option>OTHER</option></select></label><label>Identifier value<input name="identifierValue" minLength={3} required /></label><label>Issuer<input name="issuer" /></label>
      <label>Evidence type<select name="evidenceType"><option>PATIENT_DOCUMENT</option><option>REPRESENTATIVE_DOCUMENT</option><option>NATIONAL_REGISTRY</option><option>CLINICAL_CONFIRMATION</option></select></label>
      <label>Evidence reference<input name="evidenceReference" required minLength={5} /></label><label className="wide">Reason for this correction<textarea name="reason" required minLength={10} /></label><button className="primary" disabled={busy}>Record reviewed correction</button>
    </form><h3>Correction history</h3>{history.map(item => <div key={item.id}><p>{new Date(item.reconciledAt).toLocaleString()} · {item.reason} {item.reversedAt ? "· Reversed" : ""}</p>{item.reversible && <form className="queueTools" onSubmit={submit}><input name="action" type="hidden" value="REVERSE" /><input name="recordId" type="hidden" value={item.id} /><label>Reason for reversing this correction<input name="reason" required minLength={10} /></label><button disabled={busy} className="secondary">Reverse latest correction</button></form>}</div>)}</>}
  </details></section>;
}
