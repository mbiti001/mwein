"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Patient = { id: string; patientNumber: string; fullName: string };
type Consent = { id: string; type: string; granted: boolean; noticeVersion: string; method: string; evidenceReference: string | null; recordedAt: string; expiresAt: string | null; withdrawnAt: string | null; withdrawalReason: string | null };
type RightsRequest = { id: string; type: string; status: string; details: string; requestedAt: string; dueAt: string; completedAt: string | null; resolution: string | null; denialReason: string | null; evidenceReference: string | null; createdBy: { displayName: string }; updatedBy: { displayName: string } };
type PrivacyRecord = { patient: Patient; consents: Consent[]; requests: RightsRequest[] };

export default function PrivacyRightsPanel() {
  const selectedId = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [record, setRecord] = useState<PrivacyRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setPatients([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void jsonRequest<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((data) => setPatients(data.patients))
        .catch((reason) => { if ((reason as Error).name !== "AbortError") setError((reason as Error).message); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const load = useCallback(async (patient: Patient) => {
    setError("");
    const data = await jsonRequest<PrivacyRecord>(`/api/patients/${patient.id}/privacy`);
    if (selectedId.current === patient.id) setRecord(data);
  }, []);

  async function select(patient: Patient) {
    if (busy) return;
    selectedId.current = patient.id;
    setRecord(null); setSelected(patient); setPatients([]); setQuery(""); setNotice("");
    try { await load(patient); } catch (reason) { setError((reason as Error).message); }
  }

  async function act(payload: object, success: string) {
    if (!selected || busy || record?.patient.id !== selected.id) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest(`/api/patients/${selected.id}/privacy`, { method: "POST", body: JSON.stringify(payload) });
      await load(selected); setNotice(success); return true;
    } catch (reason) { setError((reason as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await act({ action: "RECORD_CONSENT", type: form.get("type"), granted: form.get("granted") === "true", noticeVersion: form.get("noticeVersion"), method: form.get("method"), evidenceReference: form.get("evidenceReference") || undefined, expiresAt: form.get("expiresAt") ? new Date(String(form.get("expiresAt"))).toISOString() : undefined }, "Consent decision recorded.");
    if (saved) formElement.reset();
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dueAt = new Date(`${String(form.get("dueAt"))}T23:59:59`);
    const saved = await act({ action: "CREATE_REQUEST", type: form.get("type"), details: form.get("details"), dueAt: dueAt.toISOString() }, "Data-subject request recorded.");
    if (saved) formElement.reset();
  }

  async function updateRequest(item: RightsRequest, status: string) {
    const payload: Record<string, unknown> = { action: "UPDATE_REQUEST", requestId: item.id, status };
    if (status === "COMPLETED") {
      const resolution = window.prompt("Resolution summary (do not include unnecessary clinical detail):");
      if (!resolution) return;
      const evidenceReference = window.prompt("Retained response/export evidence reference:");
      if (!evidenceReference) return;
      payload.resolution = resolution; payload.evidenceReference = evidenceReference;
    }
    if (status === "DENIED") {
      const denialReason = window.prompt("Reason for denial:");
      if (!denialReason) return;
      payload.denialReason = denialReason;
    }
    await act(payload, `Request moved to ${status.replaceAll("_", " ").toLowerCase()}.`);
  }

  async function downloadExport(item: RightsRequest) {
    if (!selected || busy || record?.patient.id !== selected.id) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/patients/${selected.id}/privacy/export`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: item.id }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Export could not be generated");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `mwein-patient-export-${item.id}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      await load(selected);
      setNotice("Export generated and request completed. Retain it in the approved secure delivery location.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function applyCorrection(item: RightsRequest) {
    const field = window.prompt("Field to correct: givenName, middleName, familyName, dateOfBirth, estimatedAgeYears, sexAtBirth, gender, preferredLanguage, bloodGroup, occupation, maritalStatus, or disabilityStatus");
    if (!field) return;
    const allowed = new Set(["givenName", "middleName", "familyName", "dateOfBirth", "estimatedAgeYears", "sexAtBirth", "gender", "preferredLanguage", "bloodGroup", "occupation", "maritalStatus", "disabilityStatus"]);
    if (!allowed.has(field)) { setError("That field is not available for controlled demographic correction."); return; }
    const raw = window.prompt("Corrected value (use YYYY-MM-DD for date of birth, or NULL to clear an optional field):");
    if (raw === null) return;
    const reason = window.prompt("Correction reason and verification evidence:");
    if (!reason) return;
    let value: string | number | null = raw === "NULL" ? null : raw;
    if (field === "estimatedAgeYears" && value !== null) value = Number(value);
    await act({ action: "APPLY_DEMOGRAPHIC_CORRECTION", requestId: item.id, reason, changes: { [field]: value } }, "Verified demographic correction applied and request completed.");
  }

  return <div className="embeddedWorkspace">
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    <section className="card"><div className="cardHead"><div><h2>Patient privacy and rights</h2><p>Record versioned consent decisions and manage access, correction, export and disclosure requests.</p></div></div>
      <label>Find patient<input disabled={busy} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or patient number" /></label>
      {!!patients.length && <div className="queue">{patients.map((patient) => <button type="button" className="row stockAction" disabled={busy} key={patient.id} onClick={() => void select(patient)}><span className="dot"/><div><strong>{patient.fullName}</strong><small>{patient.patientNumber}</small></div><b>Open</b></button>)}</div>}
      {selected && <div className="notice">Managing privacy record for <strong>{selected.fullName}</strong> · {selected.patientNumber}</div>}
    </section>
    {record && record.patient.id === selected?.id && <div key={record.patient.id}>
      <div className="supplyGrid"><section className="card"><div className="cardHead"><div><h2>Record consent decision</h2><p>A new decision supersedes the active record of the same type without deleting its history.</p></div></div>
        <form className="dataForm" onSubmit={recordConsent}>
          <label>Purpose<select name="type"><option>TREATMENT</option><option>ELECTRONIC_RECORD</option><option>MESSAGING</option><option>DATA_EXCHANGE</option><option>RESEARCH</option></select></label>
          <label>Decision<select name="granted"><option value="true">Granted</option><option value="false">Declined</option></select></label>
          <label>Capture method<select name="method"><option>WRITTEN</option><option>ELECTRONIC</option><option>VERBAL_WITNESSED</option></select></label>
          <label>Notice version<input name="noticeVersion" required minLength={3} maxLength={80} defaultValue="MWEIN-PRIVACY-1" /></label>
          <label>Expiry<input name="expiresAt" type="date" /></label>
          <label className="wide">Evidence reference<input name="evidenceReference" maxLength={800} placeholder="Signed form or retained electronic evidence ID" /></label>
          <button className="primary" disabled={busy}>Record decision</button>
        </form>
      </section>
      <section className="card"><div className="cardHead"><div><h2>Open a rights request</h2><p>Use the due date approved in the facility privacy procedure.</p></div></div>
        <form className="dataForm" onSubmit={createRequest}>
          <label>Request type<select name="type"><option>ACCESS</option><option>CORRECTION</option><option>PORTABLE_EXPORT</option><option>DISCLOSURE</option></select></label>
          <label>Due date<input name="dueAt" type="date" required /></label>
          <label className="wide">Request details<textarea name="details" required minLength={10} maxLength={2000} /></label>
          <button className="primary" disabled={busy}>Record request</button>
        </form>
      </section></div>
      <section className="card"><div className="cardHead"><div><h2>Consent history</h2><p>Withdrawals and superseded decisions remain visible and auditable.</p></div><strong>{record.consents.length}</strong></div><div className="queue">{record.consents.map((consent) => <div className="row" key={consent.id}><span className="dot"/><div><strong>{consent.type.replaceAll("_", " ")} · {consent.granted ? "GRANTED" : "DECLINED"}</strong><small>{consent.noticeVersion} · {consent.method.replaceAll("_", " ")} · {new Date(consent.recordedAt).toLocaleString()}</small>{consent.evidenceReference && <small>Evidence: {consent.evidenceReference}</small>}{consent.withdrawnAt && <small>Withdrawn {new Date(consent.withdrawnAt).toLocaleString()} · {consent.withdrawalReason}</small>}</div><span className={`statusPill ${consent.withdrawnAt ? "waiting" : "done"}`}>{consent.withdrawnAt ? "WITHDRAWN" : "CURRENT"}</span>{!consent.withdrawnAt && <button className="secondary" disabled={busy} onClick={() => { const reason = window.prompt("Withdrawal reason:"); if (reason) void act({ action: "WITHDRAW_CONSENT", consentId: consent.id, reason }, "Consent withdrawn."); }}>Withdraw</button>}</div>)}</div></section>
      <section className="card"><div className="cardHead"><div><h2>Data-subject requests</h2><p>Identity verification is required before review; completion requires retained response evidence.</p></div><strong>{record.requests.length}</strong></div><div className="queue">{record.requests.map((item) => <div className="row" key={item.id}><span className="dot"/><div><strong>{item.type.replaceAll("_", " ")} · {item.status.replaceAll("_", " ")}</strong><small>Due {new Date(item.dueAt).toLocaleDateString()} · opened by {item.createdBy.displayName}</small><small>{item.details}</small>{item.resolution && <small>Resolution: {item.resolution}</small>}{item.denialReason && <small>Denied: {item.denialReason}</small>}{item.evidenceReference && <small>Evidence: {item.evidenceReference}</small>}</div><div className="workstationActions">{item.status === "RECEIVED" && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "IDENTITY_VERIFIED")}>Verify identity</button>}{item.status === "IDENTITY_VERIFIED" && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "IN_REVIEW")}>Start review</button>}{item.status === "IN_REVIEW" && <>{item.type === "CORRECTION" ? <button className="primary" disabled={busy} onClick={() => void applyCorrection(item)}>Apply correction</button> : ["ACCESS", "PORTABLE_EXPORT"].includes(item.type) ? <button className="primary" disabled={busy} onClick={() => void downloadExport(item)}>Generate export</button> : <button className="primary" disabled={busy} onClick={() => void updateRequest(item, "COMPLETED")}>Complete</button>}<button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "DENIED")}>Deny</button></>}{!["COMPLETED", "DENIED", "CANCELLED"].includes(item.status) && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "CANCELLED")}>Cancel</button>}</div></div>)}</div></section>
    </div>}
  </div>;
}
