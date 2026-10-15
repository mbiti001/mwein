"use client";

import { useState, type FormEvent } from "react";
import { deliveryMethods } from "@/lib/privacy-delivery";

export default function RightsDeliveryForm({ requestId, responseReference, busy, onSave, onCancel }: {
  requestId: string; responseReference: string; busy: boolean;
  onSave: (payload: object) => Promise<boolean>; onCancel: () => void;
}) {
  const [representative, setRepresentative] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const delivered = String(form.get("deliveredAt") || "");
    await onSave({ action: "CONFIRM_DELIVERY", requestId, responseEvidenceReference: responseReference,
      recipientKind: representative ? "AUTHORIZED_REPRESENTATIVE" : "PATIENT",
      recipientReference: form.get("recipientReference"), identityEvidenceReference: form.get("identityEvidenceReference"),
      authorityEvidenceReference: representative ? form.get("authorityEvidenceReference") : undefined,
      method: form.get("method"), deliveryEvidenceReference: form.get("deliveryEvidenceReference"),
      deliveredAt: delivered ? new Date(`${delivered}+03:00`).toISOString() : undefined,
      resolution: form.get("resolution"), attested: form.get("attested") === "on" });
  }
  return <section className="card rightsDeliveryForm">
    <h3>Confirm response delivery</h3>
    <p>Record delivery only after the intended recipient has received the reviewed response through an approved channel. Use evidence references, not identity numbers or document copies. This form does not send the response.</p>
    <p>Prepared response: <span>{responseReference}</span></p>
    <form className="dataForm" onSubmit={submit} inert={busy}>
      <label>Recipient type<select onChange={event => setRepresentative(event.target.value === "AUTHORIZED_REPRESENTATIVE")} value={representative ? "AUTHORIZED_REPRESENTATIVE" : "PATIENT"}><option value="PATIENT">Patient</option><option value="AUTHORIZED_REPRESENTATIVE">Authorized representative</option></select></label>
      <label>Recipient reference<input name="recipientReference" required minLength={3} maxLength={300} /></label>
      <label>Identity verification evidence<input name="identityEvidenceReference" required minLength={3} maxLength={500} /></label>
      {representative && <label>Representative authority evidence<input name="authorityEvidenceReference" required minLength={3} maxLength={500} /></label>}
      <label>Delivery channel<select name="method">{deliveryMethods.map(method => <option key={method} value={method}>{method.replaceAll("_", " ")}</option>)}</select></label>
      <label>Delivered at (Nairobi)<input name="deliveredAt" type="datetime-local" /><small>Leave blank only if delivery occurred now.</small></label>
      <label>Delivery receipt reference<input name="deliveryEvidenceReference" required minLength={3} maxLength={500} /></label>
      <label className="wide">Response summary<textarea name="resolution" required minLength={10} maxLength={2000} /></label>
      <label className="wide check"><input name="attested" type="checkbox" required />I verified the recipient and their authority, reviewed the response scope, and retained evidence that this response was delivered.</label>
      <div className="wide workstationActions"><button className="primary" disabled={busy}>Confirm delivery and close</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Keep request open</button></div>
    </form>
  </section>;
}
