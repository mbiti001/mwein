"use client";
import { useState, type FormEvent } from "react";

export default function RightsIdentityForm({ requestId, allowExport, busy, onSave, onCancel }: {
 requestId: string; allowExport: boolean; busy: boolean; onSave: (payload: object) => Promise<boolean>; onCancel: () => void;
}) {
 const [representative, setRepresentative] = useState(false);
 const [requestKey] = useState(() => crypto.randomUUID());
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  await onSave({ action: "VERIFY_IDENTITY", requestId, requestKey,
   requesterKind: representative ? "AUTHORIZED_REPRESENTATIVE" : "PATIENT", requesterReference: form.get("requesterReference"),
   identityEvidenceReference: form.get("identityEvidenceReference"), relationship: representative ? form.get("relationship") : undefined,
   authorityEvidenceReference: representative ? form.get("authorityEvidenceReference") : undefined,
   authorizationScope: form.get("authorizationScope"), scopeSummary: form.get("scopeSummary"), attested: form.get("attested") === "on" });
 }
 return <section className="card rightsIdentityForm">
  <h3>Verify requester and authority</h3>
  <p>Check the requester against this patient and request using your approved procedure. Keep identity documents in the protected evidence store; enter references here, not identity numbers or scans. If verification is incomplete, keep the request open.</p>
  <form className="dataForm" onSubmit={submit} inert={busy}>
   <label>Requester type<select value={representative ? "AUTHORIZED_REPRESENTATIVE" : "PATIENT"} onChange={e => setRepresentative(e.target.value === "AUTHORIZED_REPRESENTATIVE")}><option value="PATIENT">Patient</option><option value="AUTHORIZED_REPRESENTATIVE">Authorized representative</option></select></label>
   <label>Requester reference<input name="requesterReference" required minLength={3} maxLength={300} /></label>
   <label>Identity check evidence<input name="identityEvidenceReference" required minLength={3} maxLength={500} /></label>
   {representative && <><label>Relationship or capacity<input name="relationship" required minLength={3} maxLength={120} /></label><label>Authority check evidence<input name="authorityEvidenceReference" required minLength={3} maxLength={500} /></label></>}
   <label>Verified scope<select aria-label="Verified scope" name="authorizationScope" defaultValue="REQUEST_REVIEW_ONLY"><option value="REQUEST_REVIEW_ONLY">Request review only — no full export</option>{allowExport && <option value="PATIENT_RECORD_EXPORT">Entire available patient-record export</option>}</select></label>
   <label className="wide">Scope and authority assessment<textarea name="scopeSummary" required minLength={10} maxLength={1000} /></label>
   <p className="wide">Full export must be within the verified request and authority. Review third-party information and the response before delivery. This check does not send records or restart the response deadline. Retained evidence cannot be overwritten.</p>
   <label className="wide check"><input name="attested" type="checkbox" required />I checked the requester against this patient, verified any representative authority, and retained evidence supporting this scope.</label>
   <div className="wide workstationActions"><button className="primary" disabled={busy}>Save identity verification</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Keep verification pending</button></div>
  </form>
 </section>;
}
