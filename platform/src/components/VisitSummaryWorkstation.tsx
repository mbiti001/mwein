"use client";
import { RecordFields, recordValue } from "./RecordFields";
import { useEffect, useRef, useState } from "react";
import SignedAddendumForm from "./SignedAddendumForm";
import { confirmWorkspaceNavigation } from "./useUnsavedConsultation";
import { careServiceProfile } from "@/lib/care-service-points";
import { FacilityLetterhead } from "@/components/FacilityBrand";
import { useWorklist } from "@/lib/use-worklist";
import { hasRecordedFindings, recordedFindings, recordedText, type RecordedFindings } from "@/lib/summary-findings";

type Summary = any;
const complaintDuration = (complaint: Summary) => {
  if (complaint.durationValue && complaint.durationUnit)
    return `${complaint.durationValue} ${String(complaint.durationUnit).toLowerCase()}`;
  return recordedText(complaint.legacyDuration);
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

export default function VisitSummaryWorkstation({ canAddendum = false, initialVisitId }: { canAddendum?: boolean; initialVisitId?: string | null }) {
  const paperRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [visitFocus, setVisitFocus] = useState(initialVisitId || null);
  const [active, setActive] = useState<Summary | null>(null);
  const list = useWorklist<{ summaries: Summary[] }>(`/api/visit-summaries?q=${encodeURIComponent(query)}${visitFocus ? `&visitId=${visitFocus}` : ""}`);
  const summaries = list.data?.summaries || [];
  const loading = list.loading;
  useEffect(() => {
    if (visitFocus && list.data) setActive(list.data.summaries.find(item => item.id === visitFocus) || null);
  }, [visitFocus, list.data]);
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
        {list.error && <div className="alert" role="alert">{list.error}<button className="secondary" onClick={() => void list.refresh()}>Retry records</button></div>}
        <section className="card search">
          <label>
            Find by patient, patient number, visit number or phone
            <input
              placeholder="Start typing to find a visit"
              value={query}
              onChange={(e) => {
                setVisitFocus(null); setQuery(e.target.value);
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
          ) : !list.error && (
            <div className="empty">
              <strong>No matching visits</strong>
              <p>Try a patient name, patient number or visit number.</p>
            </div>
          )}
        </section>
      </>
    );
  const e = active.encounter;
  const subjective = e?.subjective || {};
  const complaints = Array.isArray(subjective.complaints)
    ? subjective.complaints.filter((item: Summary) => recordedText(item?.complaint))
    : [];
  const chiefComplaint = recordedText(subjective.chiefComplaint);
  const history = recordedText(subjective.historyPresentingIllness);
  const review = recordedFindings(subjective.reviewOfSystems);
  const additionalHistory = [
    { label: "Past medical history", value: recordedText(subjective.pastMedicalHistory) },
    { label: "Current medicines", value: recordedText(subjective.currentMedicines) },
    { label: "Family and social history", value: recordedText(subjective.familySocialHistory) },
  ].filter(item => item.value);
  const hasAdditionalHistory = hasRecordedFindings(review) || additionalHistory.length > 0;
  const generalExamination = recordedFindings(e?.objective?.generalExamination);
  const systemicExamination = recordedFindings(e?.objective?.systemicExamination);
  const serviceProfile = e?.servicePointRecord ? careServiceProfile(e.servicePointRecord.servicePoint) : null;
  const serviceFields = serviceProfile?.sections.flatMap((section) => section.fields) || [];
  const verifiedLabs = active.orders.filter(
    (o: Summary) =>
      o.type === "LABORATORY" && o.laboratory?.result?.status === "VERIFIED",
  );
  const meds = active.orders.filter(
    (o: Summary) => o.type === "MEDICATION" && o.prescription &&
      ["REQUESTED", "IN_PROGRESS", "COMPLETED"].includes(o.status),
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
          <button className="secondary" onClick={() => { if (confirmWorkspaceNavigation()) { setActive(null); setVisitFocus(null); } }}>
            ← Back
          </button>{" "}
          <button className="primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>
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
        {(complaints.length > 0 || chiefComplaint || history || hasAdditionalHistory) && <SummarySection title="Reason for visit and history" wide>
          {complaints.length > 0 ? (
            complaints.map((complaint: Summary, index: number) => (
              <dl className="summaryFactsGrid summaryComplaint" key={`${complaint.complaint}-${index}`}>
                <div><dt>{complaints.length === 1 ? "Chief complaint" : `Complaint ${index + 1}`}</dt><dd>{complaint.complaint}</dd></div>
                {complaintDuration(complaint) && <div><dt>Duration</dt><dd>{complaintDuration(complaint)}</dd></div>}
              </dl>
            ))
          ) : chiefComplaint && <dl className="summaryFactsGrid summaryComplaint">
            <div><dt>Chief complaint</dt><dd>{chiefComplaint}</dd></div>
            {recordedText(subjective.symptomDuration) && <div><dt>Duration (as recorded)</dt><dd>{subjective.symptomDuration}</dd></div>}
          </dl>}
          {history && <div className="summaryNarrative"><h3>History of presenting illness</h3><p>{history}</p></div>}
          {hasAdditionalHistory && <details className="summaryDisclosure summaryHistory">
            <summary>Additional history</summary>
            <RecordedFindingBlock title="Review of systems" value={review} />
            {additionalHistory.map(item => <div className="summaryNarrative" key={item.label}><h3>{item.label}</h3><p>{item.value}</p></div>)}
          </details>}
        </SummarySection>}
        {(hasRecordedFindings(generalExamination) || hasRecordedFindings(systemicExamination)) && <SummarySection title="Examination" wide>
          <RecordedFindingBlock title="General examination" value={generalExamination} />
          <RecordedFindingBlock title="System examination" value={systemicExamination} />
        </SummarySection>}
        {e?.servicePointRecord && serviceProfile && <SummarySection title={`${serviceProfile.label} assessment`} collapsible wide>
          <RecordFields fields={[
            { label: "Risk", value: e.servicePointRecord.riskLevel },
            ...serviceFields.map(field => {
              const value = recordValue(e.servicePointRecord.data?.[field.key], true);
              return { label: field.label, value: value === null ? null : `${value}${field.unit ? ` ${field.unit}` : ""}`, wide: field.type === "textarea" };
            }),
            { label: "Specialty follow-up", value: e.servicePointRecord.followUpAt ? new Date(e.servicePointRecord.followUpAt).toLocaleDateString() : null },
          ]} />
          <small>Template {e.servicePointRecord.templateVersion}</small>
        </SummarySection>}
        {e?.diagnoses?.length > 0 && <SummarySection title="Diagnoses">
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
        </SummarySection>}
        {(recordedText(e?.plan?.plan) || active.dispositionRecord?.outcome || e?.plan?.disposition || active.clinicallyClosedAt || e?.plan?.followUpDate) && <SummarySection title="Plan and follow-up">
          <RecordFields fields={[
            { label: "Management plan", value: e?.plan?.plan, wide: true, omitUnassessed: true },
            { label: active.clinicallyClosedAt ? "Final clinical outcome" : "Consultation plan (not final discharge)", value: active.dispositionRecord?.outcome || e?.plan?.disposition },
            { label: "Follow-up", value: e?.plan?.followUpDate ? new Date(e.plan.followUpDate).toLocaleDateString() : null },
            { label: "Clinically closed", value: active.clinicallyClosedAt ? `${new Date(active.clinicallyClosedAt).toLocaleString()} · ${active.dispositionRecord?.recordedBy?.displayName || "Recorder not available"}` : null },
            { label: "Closure details", value: active.dispositionRecord?.details, wide: true },
          ]} />
        </SummarySection>}
        {e?.status === "SIGNED" && (e.addenda?.length > 0 || canAddendum) && <SummarySection title="Signed-note addenda" collapsible wide screenOnly={!e.addenda?.length}>
          {e.addenda?.length ? e.addenda.map((item: Summary) => <div className="summaryLine savedAddendum" key={item.id}><strong className="addendumAttribution">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time not recorded"} · {recordedText(item.author?.displayName) || "Recorder not recorded"}</strong><div><small>Reason</small><p>{recordedText(item.reason) || "Not recorded"}</p></div><div><small>Addendum</small><p>{recordedText(item.text) || "Not recorded"}</p></div></div>) : <p>No addenda in this loaded summary.</p>}
          {canAddendum && <SignedAddendumForm key={e.id} encounterId={e.id} onSaved={record => setActive((current: Summary | null) => current?.encounter?.id === record.encounterId ? { ...current, encounter: { ...current.encounter, addenda: [...(current.encounter.addenda || []).filter((item: Summary) => item.id !== record.id), record] } } : current)} />}
        </SummarySection>}
        {investigations.length > 0 && <SummarySection title="Investigations" wide>
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
        </SummarySection>}
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
        {meds.length > 0 && <SummarySection title="Medicines" wide>
          {meds.length ? (
            meds.map((o: Summary) => (
              <div className="summaryMedicine" key={o.id}>
                <h3>{o.displayName}</h3>
                <RecordFields fields={[
                  { label: "Medicine", value: o.prescription.genericName || o.displayName },
                  { label: "Strength", value: o.prescription.strength }, { label: "Form", value: o.prescription.dosageForm },
                  { label: "Dose", value: o.prescription.dose }, { label: "Route", value: o.prescription.route },
                  { label: "Frequency", value: o.prescription.frequency },
                  { label: "Duration", value: o.prescription.duration || (o.prescription.stopDate ? `Until ${new Date(o.prescription.stopDate).toLocaleDateString()}` : "Duration not recorded") },
                  { label: "Dispensing status", value: o.prescription.dispenseStatus.replaceAll("_", " ") },
                  { label: "Indication", value: o.clinicalIndication },
                  { label: "Instructions", value: o.prescription.instructions, wide: true },
                ]} />
                {(o.prescription.stockMovements?.length > 0 || o.prescription.dispensations?.length > 0) && <details className="summaryDisclosure summaryDispensing"><summary>Dispensing details</summary>
                {o.prescription.stockMovements?.length ? <small>Batch trace: {o.prescription.stockMovements.map((movement: Summary) => `${movement.batch.batchNumber} (${Math.abs(Number(movement.quantity))}, exp ${new Date(movement.batch.expiryDate).toLocaleDateString()})`).join(" · ")} · Counselling {o.prescription.counsellingCompleted ? "confirmed" : "not confirmed"}</small> : null}
                {o.prescription.dispensations?.map((dispensation: Summary) => <small key={dispensation.id}>Supplied: {dispensation.catalogItem?.name || o.prescription.genericName || o.displayName} · {Number(dispensation.quantity)} · {dispensation.items.map((item: Summary) => `${item.batch.batchNumber} (${Number(item.quantity)})`).join(" · ")}{dispensation.substitutionReason ? ` · Substitution reason: ${dispensation.substitutionReason}` : ""}{dispensation.fefoOverrideReason ? ` · FEFO override reason: ${dispensation.fefoOverrideReason}` : ""}</small>)}
                </details>}
              </div>
            ))
          ) : (
            <p>No medicines prescribed.</p>
          )}
        </SummarySection>}
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
          <p>Only documented history and examination findings are shown.</p>
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
function RecordedFindingBlock({ title, value }: { title: string; value: RecordedFindings }) {
  if (!hasRecordedFindings(value)) return null;
  return <div className="summaryFindingBlock">
    <h3>{title}</h3>
    {value.findings.length > 0 && <dl className="summaryFactsGrid">
      {value.findings.map((finding, index) => <div key={`${finding.label}-${index}`}><dt>{finding.label}</dt><dd>{finding.value}</dd></div>)}
    </dl>}
    {value.notes.map((note, index) => <div className="summaryNarrative" key={index}>
      {note.label && <h4>{note.label}</h4>}<p>{note.value}</p>
    </div>)}
  </div>;
}
function SummarySection({
  title,
  children,
  collapsible = false,
  wide = false,
  screenOnly = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  wide?: boolean;
  screenOnly?: boolean;
}) {
  const className = `summarySection${wide ? " summarySectionWide" : ""}${screenOnly ? " noPrint" : ""}`;
  if (collapsible) return (
    <details className={`${className} summaryFold`}>
      <summary><h2>{title}</h2></summary>
      <div className="summaryFoldBody">{children}</div>
    </details>
  );
  return <section className={className}><h2>{title}</h2>{children}</section>;
}
