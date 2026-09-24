"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FacilityLetterhead } from "./FacilityBrand";

const forms = {
  sick: { title: "Sick sheet", fields: ["Patient name", "Patient number / visit reference", "Date of assessment", "Rest advised from / to", "Return or review date", "Work or school restrictions (if applicable)", "Practitioner name and registration number"] },
  maternity: { title: "Maternity delivery record", fields: ["Mother’s name and patient number", "Visit / maternity register reference", "Delivery date and time", "Place and mode of delivery", "Maternal outcome / care record reference", "Newborn record reference(s) and outcome", "Follow-up / receiving team", "Attending practitioner name and registration number"] },
  delivery: { title: "Delivery note", fields: ["Delivery note number and date", "Supplier / dispatching department", "Receiving facility / department", "Purchase order / requisition reference", "Items, description, quantity and condition", "Delivered by / date and time", "Received by / date and time"] },
  gate: { title: "Gate pass", fields: ["Gate pass number and date", "Name and visit / authorization reference", "Destination / reason for movement", "Items or property authorized (if applicable)", "Authorized by / role", "Departure date and time", "Security officer / acknowledgement"] },
} as const;
type FormKind = keyof typeof forms;

export function ClinicFormPaper({ kind, facilityName }: { kind: FormKind; facilityName: string }) {
  const form = forms[kind];
  return <article className="clinicFormPaper">
    <FacilityLetterhead facilityName={facilityName} title={form.title} reference="Blank form · complete and authorize before issue" />
    <p className="formUseNote">{kind === "sick" ? "For completion by the assessing practitioner. This blank form is not a medical certificate." : kind === "gate" ? "Movement authorization only. This does not certify clinical discharge or payment clearance." : "Complete against the relevant source record and retain an authorized copy."}</p>
    <div className="clinicFormFields">{form.fields.map(label => <section key={label}><h2>{label}</h2><div className="writingLine" /></section>)}</div>
    <footer className="clinicFormSignatures"><div>Authorized signature<div className="writingLine" /></div><div>Date and facility stamp<div className="writingLine" /></div></footer>
    <p className="formUseNote">Keep completed forms securely. Include only information needed by the intended recipient.</p>
  </article>;
}

export default function ClinicForms({ facilityName }: { facilityName: string }) {
  const [kind, setKind] = useState<FormKind>("sick");
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  async function print() {
    setError(""); setPrinting(true);
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const images = Array.from(document.querySelectorAll<HTMLImageElement>("#clinic-form-print img"));
      await Promise.all(images.map(img => img.decode()));
      document.body.classList.add("printingClinicForm");
      window.print();
    } catch { setError("The letterhead could not be prepared. Please retry before printing."); }
    finally { document.body.classList.remove("printingClinicForm"); setPrinting(false); }
  }
  return <>
    <header><div><p className="eyebrow">Facility stationery</p><h1>Clinic forms</h1><p>Print branded blank forms for completion and authorization by the responsible staff member.</p></div></header>
    <section className="card noPrint clinicFormTools"><label>Document type<select value={kind} onChange={event => setKind(event.target.value as FormKind)}>{Object.entries(forms).map(([key, form]) => <option key={key} value={key}>{form.title}</option>)}</select></label><button className="primary" disabled={printing} onClick={() => void print()}>{printing ? "Preparing…" : "Print blank form / Save PDF"}</button><p>For populated clinical referrals, use Service points → Referrals. These blank forms do not save a patient record or issue an electronic certificate.</p>{error && <p role="alert">{error}</p>}</section>
    <ClinicFormPaper kind={kind} facilityName={facilityName} />
    {printing && createPortal(<div id="clinic-form-print"><ClinicFormPaper kind={kind} facilityName={facilityName} /></div>, document.body)}
  </>;
}
