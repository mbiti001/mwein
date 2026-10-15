"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { rightsRequestPolicy, rightsRequestIsOverdue, type DataSubjectRequestType } from "@/lib/privacy";
import { RecordFields } from "./RecordFields";
import RightsDeliveryForm from "./RightsDeliveryForm";
import type { DeliveryEvidence } from "@/lib/privacy-delivery";

const rightsDate = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

type Patient = { id: string; patientNumber: string; fullName: string };
type Consent = { id: string; type: string; granted: boolean; noticeVersion: string; method: string; evidenceReference: string | null; recordedAt: string; expiresAt: string | null; withdrawnAt: string | null; withdrawalReason: string | null };
type RightsRequest = { id: string; type: string; status: string; details: string; requestedAt: string; dueAt: string; completedAt: string | null; resolution: string | null; denialReason: string | null; evidenceReference: string | null; responsePreparedAt: string | null; responseEvidenceReference: string | null; deliveryEvidence: DeliveryEvidence | null; createdBy: { displayName: string }; updatedBy: { displayName: string } };
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
  const [requestType, setRequestType] = useState<DataSubjectRequestType>("ACCESS");
  const [deliveryRequestId, setDeliveryRequestId] = useState<string | null>(null);

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
    setDeliveryRequestId(null);
    setRecord(null); setSelected(patient); setPatients([]); setQuery(""); setNotice(""); setRequestType("ACCESS");
    try { await load(patient); } catch (reason) { setError((reason as Error).message); }
  }

  async function act(payload: object, success: string) {
    if (!selected || busy || record?.patient.id !== selected.id) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest(`/api/patients/${selected.id}/privacy`, { method: "POST", body: JSON.stringify(payload) });
      setNotice(success);
      try { await load(selected); }
      catch { setRecord(null); setError("Saved successfully, but the updated history could not be loaded. Reload the privacy record before continuing; do not submit the request again."); }
      return true;
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
    const receipt = String(form.get("receivedAt") || "");
    const saved = await act({ action: "CREATE_REQUEST", type: requestType, details: form.get("details"), receivedAt: receipt ? new Date(`${receipt}+03:00`).toISOString() : undefined }, "Data-subject request recorded.");
    if (saved) { formElement.reset(); setRequestType("ACCESS"); }
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
    let regenerationReason: string | undefined;
    if (item.responseEvidenceReference) {
      const reason = window.prompt("Reason for replacing the prepared export (at least 10 characters). Prior preparation remains audited. Deliver only the latest reviewed response.");
      if (!reason) return;
      regenerationReason = reason;
    }
    setDeliveryRequestId(null);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/patients/${selected.id}/privacy/export`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: item.id, previousResponseReference: item.responseEvidenceReference || undefined, regenerationReason }),
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
      setNotice("Export prepared for review. The request remains open until delivery is confirmed with retained evidence.");
      try { await load(selected); }
      catch { setRecord(null); setError("Export prepared, but history could not be refreshed. Reload the privacy record to review its status before continuing."); }
    } catch (reason) {
      const message = (reason as Error).message;
      try { await load(selected); } catch { setRecord(null); }
      setError(`${message}. If preparation was recorded but the file was not received, use Regenerate export with a reason. Do not confirm delivery without evidence.`);
    }
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

  return <div className="embeddedWorkspace privacyRightsWorkspace">
    {error && <div className="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <section className="card"><div className="cardHead"><div><h2>Patient privacy and rights</h2><p>Record versioned consent decisions and manage access, correction, export and disclosure requests.</p></div></div>
      <label>Find patient<input disabled={busy} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or patient number" /></label>
      {!!patients.length && <div className="queue">{patients.map((patient) => <button type="button" className="row stockAction" disabled={busy} key={patient.id} onClick={() => void select(patient)}><span className="dot"/><div><strong>{patient.fullName}</strong><small>{patient.patientNumber}</small></div><b>Open</b></button>)}</div>}
      {selected && <div className="notice">Managing privacy record for <strong>{selected.fullName}</strong> · {selected.patientNumber}</div>}
      {selected && !busy && <button className="secondary" onClick={() => {
        if (deliveryRequestId && !window.confirm("Reload the saved privacy record and discard the delivery details currently entered? This does not resend the response.")) return;
        void select(selected);
      }}>Reload privacy record</button>}
    </section>
    {record && record.patient.id === selected?.id && <div key={record.patient.id}>
      <div className="supplyGrid"><section className="card"><div className="cardHead"><div><h2>Record consent decision</h2><p>A new decision supersedes the active record of the same type without deleting its history.</p></div></div>
        <form className="dataForm" onSubmit={recordConsent} inert={busy}>
          <label>Purpose<select name="type"><option>TREATMENT</option><option>ELECTRONIC_RECORD</option><option>MESSAGING</option><option>DATA_EXCHANGE</option><option>RESEARCH</option></select></label>
          <label>Decision<select name="granted"><option value="true">Granted</option><option value="false">Declined</option></select></label>
          <label>Capture method<select name="method"><option>WRITTEN</option><option>ELECTRONIC</option><option>VERBAL_WITNESSED</option></select></label>
          <label>Notice version<input name="noticeVersion" required minLength={3} maxLength={80} defaultValue="MWEIN-PRIVACY-1" /></label>
          <label>Expiry<input name="expiresAt" type="date" /></label>
          <label className="wide">Evidence reference<input name="evidenceReference" maxLength={800} placeholder="Signed form or retained electronic evidence ID" /></label>
          <button className="primary" disabled={busy}>Record decision</button>
        </form>
      </section>
      <section className="card"><div className="cardHead"><div><h2>Open a rights request</h2><p>The response target starts at original receipt, including requests entered late. Identity checks do not restart it.</p></div></div>
        <form className="dataForm" onSubmit={createRequest} inert={busy}>
          <label>Request type<select name="type" value={requestType} onChange={(event) => setRequestType(event.target.value as DataSubjectRequestType)}><option>ACCESS</option><option>CORRECTION</option><option>PORTABLE_EXPORT</option><option>DISCLOSURE</option></select></label>
          <label>Received at (Nairobi)<input name="receivedAt" type="datetime-local" aria-describedby="rights-receipt-help" /></label>
          <p className="wide" id="rights-receipt-help">Leave receipt blank only for a request received now. For earlier requests, enter the original receipt time.</p>
          <p className="wide" role="status">{rightsRequestPolicy[requestType].label}. Calculated automatically from receipt. Refusal notices and other obligations may be due sooner; refer to the privacy procedure.</p>
          <label className="wide">Request details<textarea name="details" required minLength={10} maxLength={2000} /></label>
          <button className="primary" disabled={busy}>Record request</button>
        </form>
      </section></div>
      <section className="card"><div className="cardHead"><div><h2>Consent history</h2><p>Withdrawals and superseded decisions remain visible and auditable.</p></div><strong>{record.consents.length}</strong></div><div className="queue">{record.consents.map((consent) => <div className="row" key={consent.id}><span className="dot"/><div><strong>{consent.type.replaceAll("_", " ")} · {consent.granted ? "GRANTED" : "DECLINED"}</strong><small>{consent.noticeVersion} · {consent.method.replaceAll("_", " ")} · {new Date(consent.recordedAt).toLocaleString()}</small>{consent.evidenceReference && <small>Evidence: {consent.evidenceReference}</small>}{consent.withdrawnAt && <small>Withdrawn {new Date(consent.withdrawnAt).toLocaleString()} · {consent.withdrawalReason}</small>}</div><span className={`statusPill ${consent.withdrawnAt ? "waiting" : "done"}`}>{consent.withdrawnAt ? "WITHDRAWN" : "CURRENT"}</span>{!consent.withdrawnAt && <button className="secondary" disabled={busy} onClick={() => { const reason = window.prompt("Withdrawal reason:"); if (reason) void act({ action: "WITHDRAW_CONSENT", consentId: consent.id, reason }, "Consent withdrawn."); }}>Withdraw</button>}</div>)}</div></section>
      <section className="card"><div className="cardHead"><div><h2>Data-subject requests</h2><p>Identity verification is required before review; completion requires retained response evidence.</p></div><strong>{record.requests.length}</strong></div><div className="queue">{record.requests.map((item) => <div className="row" key={item.id}><span className="dot"/><div><strong>{item.type.replaceAll("_", " ")} · {item.status.replaceAll("_", " ")}</strong><RecordFields fields={[{ label: "Received (Nairobi)", value: rightsDate(item.requestedAt) }, { label: "Response target (Nairobi)", value: rightsDate(item.dueAt) }, { label: "Recorded by", value: item.createdBy.displayName }, { label: "Last updated by", value: item.updatedBy.displayName }, { label: "Request details", value: item.details, wide: true }, { label: "Resolution", value: item.resolution, wide: true }, { label: "Denial reason", value: item.denialReason, wide: true }, { label: "Evidence", value: item.evidenceReference, wide: true }, { label: "Response prepared (Nairobi)", value: item.responsePreparedAt ? rightsDate(item.responsePreparedAt) : null }, { label: "Prepared response evidence", value: item.responseEvidenceReference }, { label: "Delivered (Nairobi)", value: item.deliveryEvidence ? rightsDate(item.deliveryEvidence.deliveredAt) : null }, { label: "Recipient reference", value: item.deliveryEvidence?.recipientReference }, { label: "Recipient type", value: item.deliveryEvidence?.recipientKind.replaceAll("_", " ") }, { label: "Identity verification evidence", value: item.deliveryEvidence?.identityEvidenceReference }, { label: "Representative authority evidence", value: item.deliveryEvidence?.authorityEvidenceReference }, { label: "Delivery channel", value: item.deliveryEvidence?.method.replaceAll("_", " ") }, { label: "Delivery receipt", value: item.deliveryEvidence?.deliveryEvidenceReference }, { label: "Delivery status", value: ["ACCESS", "PORTABLE_EXPORT"].includes(item.type) && !item.deliveryEvidence ? (item.status === "COMPLETED" ? "Delivery evidence not recorded for this earlier completion" : item.responseEvidenceReference ? "Prepared — delivery confirmation outstanding" : null) : null }]} />{rightsRequestIsOverdue(item.status, item.dueAt) && <strong className="alert">Overdue — response requires attention</strong>}</div><div className="workstationActions">{item.status === "RECEIVED" && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "IDENTITY_VERIFIED")}>Verify identity</button>}{item.status === "IDENTITY_VERIFIED" && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "IN_REVIEW")}>Start review</button>}{item.status === "IN_REVIEW" && <>{item.type === "CORRECTION" ? <button className="primary" disabled={busy} onClick={() => void applyCorrection(item)}>Apply correction</button> : ["ACCESS", "PORTABLE_EXPORT"].includes(item.type) ? <><button className="primary" disabled={busy} onClick={() => void downloadExport(item)}>{item.responseEvidenceReference ? "Regenerate export" : "Generate export"}</button>{item.responseEvidenceReference && <button className="secondary" disabled={busy} onClick={() => setDeliveryRequestId(item.id)}>Record delivery</button>}</> : <button className="primary" disabled={busy} onClick={() => void updateRequest(item, "COMPLETED")}>Complete</button>}<button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "DENIED")}>Deny</button></>}{!["COMPLETED", "DENIED", "CANCELLED"].includes(item.status) && <button className="secondary" disabled={busy} onClick={() => void updateRequest(item, "CANCELLED")}>Cancel</button>}</div>{item.status === "IN_REVIEW" && item.responseEvidenceReference && deliveryRequestId === item.id && <RightsDeliveryForm key={item.responseEvidenceReference} requestId={item.id} responseReference={item.responseEvidenceReference} busy={busy} onCancel={() => setDeliveryRequestId(null)} onSave={async payload => { const saved = await act(payload, "Response delivery recorded and request completed."); if (saved) setDeliveryRequestId(null); return saved; }} />}</div>)}</div></section>
    </div>}
  </div>;
}
