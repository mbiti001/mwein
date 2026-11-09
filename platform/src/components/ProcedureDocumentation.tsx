"use client";
import { chargeMoney, type OrderCharge } from "@/lib/order-charges";
import { useState } from "react";

import { procedureRecordSchema } from "@/lib/consultation";
import type { z } from "zod";
type Procedure = z.infer<typeof procedureRecordSchema> & { id: string; performedById: string; recordedAt: string; charge?: OrderCharge };
function savedProcedures(plan?: string | null): Procedure[] {
  try { return JSON.parse(plan || "{}").procedures || []; } catch { return []; }
}
type ProcedureCatalogueItem = { code: string; name: string; category: string; modality?: string | null; unitPrice: string };
export default function ProcedureDocumentation({ onSave, savedPlan, catalogue = [], onRecorded }: { onSave: (data: object) => Promise<{ procedure: Procedure } | false>; savedPlan?: string | null; catalogue?: ProcedureCatalogueItem[]; onRecorded?: () => Promise<void> }) {
  const [procedureName, setProcedureName] = useState("");
  const services = catalogue.filter(item => item.category === "PROCEDURE" && !item.code.startsWith("CONSULT-") && (!item.modality || item.modality === "PROCEDURE"));
  const selectedService = services.find(item => item.name.trim().toLowerCase() === procedureName.trim().toLowerCase());
  const [procedures, setProcedures] = useState(() => savedProcedures(savedPlan));
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function record(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form || busy) return;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const performedAt = String(values.get("procedure_performedAt") || "");
      const data = procedureRecordSchema.parse({
        idempotencyKey, catalogCode: selectedService?.code,
        ...Object.fromEntries(["name", "indication", "consent", "consentNote", "anaesthesia", "findings", "complications", "aftercare"].map(key => [key, values.get(`procedure_${key}`)])),
        performedAt: performedAt ? new Date(`${performedAt}:00+03:00`).toISOString() : "",
      });
      const result = await onSave(data);
      if (!result) return;
      setProcedures(current => current.some(item => item.id === result.procedure.id) ? current : [...current, result.procedure]);
      setIdempotencyKey(crypto.randomUUID());
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name^="procedure_"], textarea[name^="procedure_"]').forEach(input => { input.value = ""; });
      setProcedureName("");
      const consent = form.elements.namedItem("procedure_consent");
      if (consent instanceof HTMLSelectElement) consent.selectedIndex = 0;
      setMessage(result.procedure.charge ? `Procedure recorded and ${chargeMoney(result.procedure.charge.total)} linked to the visit invoice.` : "Procedure recorded. No catalogue tariff was selected; no charge was invented.");
      await onRecorded?.().catch(() => setMessage("Procedure saved. Refresh the visit to see its latest service charges."));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Procedure could not be recorded"); }
    finally { setBusy(false); }
  }
  return <>
    <p>Save the history and examination before recording a procedure. The signed-in clinician is recorded as the operator. Use this form only for procedures you performed.</p>
    {procedures.map(procedure => <article className="clinicalBoundary" key={procedure.id}>
      <strong>{procedure.name} · {new Date(procedure.performedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</strong>
      {procedure.charge && <span>Service charge: {chargeMoney(procedure.charge.total)}</span>}
      <span>{procedure.findings}</span><span>Complications: {procedure.complications}</span><span>Aftercare: {procedure.aftercare}</span>
    </article>)}
    <fieldset disabled={busy} className="formGrid">
      <legend>Completed procedure record</legend>
      <label>Procedure name<input name="procedure_name" value={procedureName} onChange={event => setProcedureName(event.target.value)} list="minor-procedures" maxLength={200} placeholder="Select or enter procedure" /></label>
      <datalist id="minor-procedures">{services.map(item => <option key={item.code} value={item.name} />)}<option value="Wound suturing / stitching" /><option value="Male circumcision" /><option value="Wound dressing" /><option value="Incision and drainage" /><option value="Suture removal" /><option value="Foreign body removal" /></datalist>
      <p>{selectedService ? `Service price: ${chargeMoney(Number(selectedService.unitPrice))}. Added to the same visit invoice when recorded.` : "Select a catalogue procedure for its configured service price."}</p>
      <label>Performed at (Kenya time)<input name="procedure_performedAt" type="datetime-local" /></label>
      <label>Indication<textarea name="procedure_indication" maxLength={1000} /></label>
      <label>Consent<select name="procedure_consent"><option value="OBTAINED">Informed consent obtained</option><option value="EMERGENCY_EXCEPTION">Emergency exception documented</option></select></label>
      <label>Consent details / guardian or exception rationale<textarea name="procedure_consentNote" maxLength={1000} /></label>
      <label>Anaesthesia / analgesia (state none if applicable)<textarea name="procedure_anaesthesia" maxLength={1000} /></label>
      <label>Technique and findings<textarea name="procedure_findings" maxLength={3000} /></label>
      <label>Complications (state none if applicable)<textarea name="procedure_complications" maxLength={1000} /></label>
      <label>Aftercare and review plan<textarea name="procedure_aftercare" maxLength={3000} /></label>
      <button type="button" className="primary" onClick={record}>{busy ? "Recording…" : "Record completed procedure"}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
  </>;
}
