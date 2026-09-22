"use client";
import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import { careServiceProfile } from "@/lib/care-service-points";
import { FacilityLetterhead } from "@/components/FacilityBrand";

type Summary = any;
const display = (value?: string | null) => value || "Not recorded";
const complaintDuration = (complaint: Summary) => {
  if (complaint.durationValue && complaint.durationUnit)
    return `${complaint.durationValue} ${String(complaint.durationUnit).toLowerCase()}`;
  return complaint.legacyDuration || "Duration not recorded";
};
const money = (value: number, currency = "KES") =>
  `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function age(patient: Summary["patient"]) {
  if (patient.dateOfBirth) {
    const years = Math.floor(
      (Date.now() - new Date(patient.dateOfBirth).getTime()) / 31557600000,
    );
    return `${years} years`;
  }
  return patient.estimatedAgeYears != null
    ? `About ${patient.estimatedAgeYears} years`
    : "Age not recorded";
}

export default function VisitSummaryWorkstation({ canAddendum = false }: { canAddendum?: boolean }) {
  const paperRef = useRef<HTMLElement>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [active, setActive] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAddendum, setSavingAddendum] = useState(false);
  async function load(q = "") {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/visit-summaries?q=${encodeURIComponent(q)}`,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Visit summaries could not be loaded");
      setSummaries(data.summaries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    let collapsed: HTMLDetailsElement[] = [];
    const expandForPrint = () => {
      collapsed = Array.from(paperRef.current?.querySelectorAll<HTMLDetailsElement>("details:not([open])") || []);
      collapsed.forEach(detail => { detail.open = true; });
    };
    const restoreAfterPrint = () => {
      collapsed.forEach(detail => { detail.open = false; });
      collapsed = [];
    };
    window.addEventListener("beforeprint", expandForPrint);
    window.addEventListener("afterprint", restoreAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", expandForPrint);
      window.removeEventListener("afterprint", restoreAfterPrint);
    };
  }, []);
  if (!active)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Clinical records</p>
            <h1>Visit summaries</h1>
            <p>
              Find any active or completed visit and produce a patient-facing
              clinical summary.
            </p>
          </div>
        </header>
        {error && <div className="alert">{error}</div>}
        <section className="card search">
          <label>
            Find by patient, patient number, visit number or phone
            <input
              placeholder="Start typing to find a visit"
              onChange={(e) => {
                const value = e.target.value;
                window.clearTimeout((window as any).__visitSearch);
                (window as any).__visitSearch = window.setTimeout(
                  () => load(value),
                  300,
                );
              }}
            />
          </label>
        </section>
        <section className="card">
          {loading ? (
            <div className="empty">
              <strong>Loading visits…</strong>
            </div>
          ) : summaries.length ? (
            <div className="queue">
              {summaries.map((v) => (
                <button
                  className={`row ${v.priority.toLowerCase()}`}
                  onClick={() => setActive(v)}
                  key={v.id}
                >
                  <span className="dot" />
                  <div>
                    <strong>{v.patient.fullName}</strong>
                    <small>
                      {v.patient.patientNumber} · {v.clinic} ·{" "}
                      {new Date(v.arrivedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <b>{v.status.replaceAll("_", " ")}</b>
                  <time>{v.visitNumber}</time>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <strong>No matching visits</strong>
              <p>Try a patient name, patient number or visit number.</p>
            </div>
          )}
        </section>
      </>
    );
  const e = active.encounter;
  const complaints = Array.isArray(e?.subjective.complaints)
    ? e.subjective.complaints
    : [];
  const serviceProfile = e?.servicePointRecord ? careServiceProfile(e.servicePointRecord.servicePoint) : null;
  const serviceFields = serviceProfile?.sections.flatMap((section) => section.fields) || [];
  const verifiedLabs = active.orders.filter(
    (o: Summary) =>
      o.type === "LABORATORY" && o.laboratory?.result?.status === "VERIFIED",
  );
  const meds = active.orders.filter(
    (o: Summary) => o.type === "MEDICATION" && o.prescription,
  );
  const investigations = active.orders.filter((o: Summary) =>
    ["LABORATORY", "IMAGING"].includes(o.type),
  );
  const verifiedImaging = investigations.filter(
    (o: Summary) => o.type === "IMAGING" && o.imaging?.result?.status === "VERIFIED",
  );
  const total =
    active.invoice?.items.reduce(
      (s: number, i: Summary) => s + Number(i.quantity) * Number(i.unitPrice),
      0,
    ) || 0;
  const paid =
    active.invoice?.payments.reduce(
      (s: number, p: Summary) => s + Number(p.amount),
      0,
    ) || 0;
  return (
    <>
      <header className="noPrint">
        <div>
          <p className="eyebrow">Visit summary</p>
          <h1>Clinical record</h1>
        </div>
        <div>
          <button className="secondary" onClick={() => setActive(null)}>
            ← Back
          </button>{" "}
          <button className="primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>
      {error && <div className="alert noPrint" role="alert">{error}</div>}
      <article className="visitSummaryPaper compactVisitSummary" ref={paperRef}>
        <FacilityLetterhead
          facilityName={active.facility.name}
          title="Visit summary"
          reference={`${active.facility.code} · Generated ${new Date().toLocaleString()}`}
          badge={<strong className={e?.status === "SIGNED" ? "signedStatus" : "draftStatus"}>{e?.status === "SIGNED" ? "SIGNED CLINICAL RECORD" : "DRAFT / INCOMPLETE"}</strong>}
        />
        <section className="summaryIdentity">
          <div>
            <small>Patient</small>
            <strong>{active.patient.fullName}</strong>
            <span>{active.patient.patientNumber}</span>
          </div>
          <div>
            <small>Demographics</small>
            <strong>
              {active.patient.sexAtBirth} · {age(active.patient)}
            </strong>
          </div>
          <div>
            <small>Visit</small>
            <strong>{active.visitNumber}</strong>
            <span>
              {active.clinic} · {new Date(active.arrivedAt).toLocaleString()}
            </span>
          </div>
          <div>
            <small>Clinician</small>
            <strong>{e?.clinician.displayName || "Not assigned"}</strong>
            <span>
              {e?.signedAt
                ? `Signed ${new Date(e.signedAt).toLocaleString()}`
                : "Not signed"}
            </span>
          </div>
        </section>
        {active.patient.allergies.length > 0 && (
          <section className="summaryAlert">
            <strong>Allergies</strong>
            <span>
              {active.patient.allergies
                .map(
                  (a: Summary) =>
                    `${a.substance}${a.reaction ? ` — ${a.reaction}` : ""}`,
                )
                .join("; ")}
            </span>
          </section>
        )}
        <div className="visitSummaryGrid">
        <SummarySection title="Reason for visit and history">
          {complaints.length > 0 ? (
            complaints.map((complaint: Summary, index: number) => (
              <div className="summaryLine" key={`${complaint.complaint}-${index}`}>
                <strong>Complaint {index + 1}</strong>
                <span>
                  {display(complaint.complaint)} · {complaintDuration(complaint)}
                </span>
              </div>
            ))
          ) : (
            <>
              <p>
                <b>Chief complaint:</b> {display(e?.subjective.chiefComplaint)}
              </p>
              <p>
                <b>Duration:</b> {display(e?.subjective.symptomDuration)}
              </p>
            </>
          )}
          <p>
            <b>History:</b> {display(e?.subjective.historyPresentingIllness)}
          </p>
          {(e?.subjective.reviewOfSystems || e?.subjective.pastMedicalHistory) && <details className="summaryDisclosure">
            <summary>Additional history</summary>
            {e.subjective.reviewOfSystems && <div><strong>Review of systems</strong><pre>{e.subjective.reviewOfSystems}</pre></div>}
            {e.subjective.pastMedicalHistory && <div><strong>Past medical history</strong><pre>{e.subjective.pastMedicalHistory}</pre></div>}
          </details>}
        </SummarySection>
        <SummarySection title="Examination">
          <pre>{display(e?.objective.generalExamination)}</pre>
          <pre>{display(e?.objective.systemicExamination)}</pre>
        </SummarySection>
        {e?.servicePointRecord && serviceProfile && <SummarySection title={`${serviceProfile.label} assessment`} collapsible wide>
          <div className="summaryLine"><strong>Risk</strong><span>{display(e.servicePointRecord.riskLevel)}</span></div>
          {serviceFields.filter((field) => {
            const value = e.servicePointRecord.data?.[field.key];
            return value !== undefined && value !== "" && value !== false;
          }).map((field) => <div className="summaryLine" key={field.key}><strong>{field.label}</strong><span>{String(e.servicePointRecord.data[field.key])}{field.unit ? ` ${field.unit}` : ""}</span></div>)}
          {e.servicePointRecord.followUpAt && <div className="summaryLine"><strong>Specialty follow-up</strong><span>{new Date(e.servicePointRecord.followUpAt).toLocaleDateString()}</span></div>}
          <small>Template {e.servicePointRecord.templateVersion}</small>
        </SummarySection>}
        <SummarySection title="Diagnoses">
          {e?.diagnoses.length ? (
            e.diagnoses.map((d: Summary) => (
              <div className="summaryLine" key={d.id}>
                <strong>{d.primary ? "Primary" : "Additional"}</strong>
                <span>
                  {d.code} · {d.description} ({d.type.toLowerCase()})
                </span>
              </div>
            ))
          ) : (
            <p>No diagnosis recorded.</p>
          )}
        </SummarySection>
        <SummarySection title="Plan and follow-up">
          <p>{display(e?.plan.plan)}</p>
          <div className="summaryLine">
            <strong>{active.clinicallyClosedAt ? "Final clinical outcome" : "Consultation plan (not final discharge)"}</strong>
            <span>{display(active.dispositionRecord?.outcome || e?.plan.disposition)}</span>
          </div>
          {active.clinicallyClosedAt && <p>Clinically closed {new Date(active.clinicallyClosedAt).toLocaleString()} · {active.dispositionRecord?.recordedBy?.displayName}. {active.dispositionRecord?.details}</p>}
          <div className="summaryLine">
            <strong>Follow-up</strong>
            <span>
              {e?.plan.followUpDate
                ? new Date(e.plan.followUpDate).toLocaleDateString()
                : "Not scheduled"}
            </span>
          </div>
        </SummarySection>
        {e?.status === "SIGNED" && (e.addenda?.length > 0 || canAddendum) && <SummarySection title="Signed-note addenda" collapsible wide>
          {e.addenda?.length ? e.addenda.map((item: Summary) => <div className="summaryLine" key={item.id}><strong>{new Date(item.createdAt).toLocaleString()} · {item.author.displayName}</strong><span>{item.reason}: {item.text}</span></div>) : <p>No addenda recorded.</p>}
          {canAddendum && <form className="dataForm noPrint" onSubmit={async event => { event.preventDefault(); setSavingAddendum(true); setError(""); const formElement = event.currentTarget; const form = new FormData(formElement); try { const result = await jsonRequest<any>(`/api/encounters/${e.id}/addenda`, { method: "POST", body: JSON.stringify({ reason: form.get("reason"), text: form.get("text") }) }, "Addendum could not be saved"); setActive({ ...active, encounter: { ...e, addenda: [...(e.addenda || []), result.addendum] } }); formElement.reset(); } catch (reason) { setError((reason as Error).message); } finally { setSavingAddendum(false); } }}><label>Reason *<input name="reason" required minLength={5} placeholder="Correction, clarification, or late information" /></label><label>Addendum *<textarea name="text" required minLength={5} rows={3} placeholder="Add new information without changing the signed note" /></label><button className="secondary" disabled={savingAddendum}>{savingAddendum ? "Adding…" : "Add signed addendum"}</button></form>}
        </SummarySection>}
        <SummarySection title="Investigations" wide>
          {investigations.length ? (
            investigations.map((o: Summary) => (
              <div className="summaryLine" key={o.id}>
                <strong>{o.type}</strong>
                <span>
                  {o.displayName} · {o.status.replaceAll("_", " ")}
                </span>
              </div>
            ))
          ) : (
            <p>No investigations requested.</p>
          )}
        </SummarySection>
        {verifiedLabs.length > 0 && <SummarySection title="Laboratory findings" collapsible wide>
          {verifiedLabs.length ? verifiedLabs.map((o: Summary) => (
            <table className="reportResults" key={o.id}>
              <caption>
                {o.displayName} · Verified by{" "}
                {o.laboratory.result.verifiedBy?.displayName || "Laboratory"}
              </caption>
              <thead>
                <tr>
                  <th>Analyte</th>
                  <th>Result</th>
                  <th>Reference</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {o.laboratory.result.items.map((i: Summary) => (
                  <tr key={i.id}>
                    <td>{i.analyte}</td>
                    <td>
                      {i.value} {i.unit}
                    </td>
                    <td>{i.referenceRange || "—"}</td>
                    <td>{i.flag || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )) : <p>No verified laboratory findings for this visit.</p>}
        </SummarySection>}
        {verifiedImaging.length > 0 && <SummarySection title="Imaging findings" collapsible wide>
          {verifiedImaging.map((o: Summary) => (
            <div className="reportComment" key={`report-${o.id}`}><strong>{o.displayName} conclusion</strong><p>{o.imaging.result.conclusion}</p><small>Verified by {o.imaging.result.verifiedBy?.displayName || "Imaging service"}</small></div>
          ))}
        </SummarySection>}
        <SummarySection title="Medicines" wide>
          {meds.length ? (
            meds.map((o: Summary) => (
              <div className="summaryLine" key={o.id}>
                <strong>{o.displayName}</strong>
                <span>
                  {o.prescription.genericName || o.displayName}{o.prescription.strength ? ` ${o.prescription.strength}` : ""} · {o.prescription.dosageForm || "medicine"} · {o.prescription.dose} · {o.prescription.route} ·{" "}
                  {o.prescription.frequency} · {o.prescription.duration || (o.prescription.stopDate ? `until ${new Date(o.prescription.stopDate).toLocaleDateString()}` : "duration not recorded")}
                  {o.clinicalIndication ? ` · Indication: ${o.clinicalIndication}` : ""}
                  {o.prescription.instructions
                    ? ` · ${o.prescription.instructions}`
                    : ""}{" "}
                  · {o.prescription.dispenseStatus.replaceAll("_", " ")}
                </span>
                {(o.prescription.stockMovements?.length > 0 || o.prescription.dispensations?.length > 0) && <details className="summaryDisclosure summaryDispensing"><summary>Dispensing details</summary>
                {o.prescription.stockMovements?.length ? <small>Batch trace: {o.prescription.stockMovements.map((movement: Summary) => `${movement.batch.batchNumber} (${Math.abs(Number(movement.quantity))}, exp ${new Date(movement.batch.expiryDate).toLocaleDateString()})`).join(" · ")} · Counselling {o.prescription.counsellingCompleted ? "confirmed" : "not confirmed"}</small> : null}
                {o.prescription.dispensations?.map((dispensation: Summary) => <small key={dispensation.id}>Supplied: {dispensation.catalogItem?.name || o.prescription.genericName || o.displayName} · {Number(dispensation.quantity)} · {dispensation.items.map((item: Summary) => `${item.batch.batchNumber} (${Number(item.quantity)})`).join(" · ")}{dispensation.substitutionReason ? ` · Substitution reason: ${dispensation.substitutionReason}` : ""}{dispensation.fefoOverrideReason ? ` · FEFO override reason: ${dispensation.fefoOverrideReason}` : ""}</small>)}
                </details>}
              </div>
            ))
          ) : (
            <p>No medicines prescribed.</p>
          )}
        </SummarySection>
        {active.referrals?.length > 0 && <SummarySection title="Referrals" wide>
          {active.referrals?.length ? active.referrals.map((referral: Summary) => <div className="summaryLine" key={referral.id}><strong>{referral.referralNumber} · {referral.status}</strong><span>{referral.urgency} · {referral.reason} · To {referral.receivingFacility}{referral.receivingDepartment ? ` / ${referral.receivingDepartment}` : ""}{referral.feedback ? ` · Feedback: ${referral.feedback}` : ""}</span></div>) : <p>No referrals recorded for this visit.</p>}
        </SummarySection>}
        {active.invoice && (
          <SummarySection title="Billing" collapsible wide>
            <div className="summaryLine">
              <strong>{active.invoice.invoiceNumber}</strong>
              <span>
                Total {money(total, active.invoice.currency)} · Paid{" "}
                {money(paid, active.invoice.currency)} · Balance{" "}
                {money(Math.max(0, total - paid), active.invoice.currency)} ·{" "}
                {active.invoice.status}
              </span>
            </div>
          </SummarySection>
        )}
        </div>
        <footer>
          <p>
            This summary supports continuity of care. Seek urgent medical
            attention if symptoms worsen or emergency warning signs develop.
          </p>
          <p>Confidential clinician-only notes are intentionally excluded.</p>
        </footer>
      </article>
    </>
  );
}
function SummarySection({
  title,
  children,
  collapsible = false,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  wide?: boolean;
}) {
  const className = `summarySection${wide ? " summarySectionWide" : ""}`;
  if (collapsible) return (
    <details className={`${className} summaryFold`}>
      <summary><h2>{title}</h2></summary>
      <div className="summaryFoldBody">{children}</div>
    </details>
  );
  return <section className={className}><h2>{title}</h2>{children}</section>;
}
