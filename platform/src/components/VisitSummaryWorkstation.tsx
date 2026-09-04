"use client";
import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type Summary = any;
const display = (value?: string | null) => value || "Not recorded";
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
          <h1>{active.patient.fullName}</h1>
          <p>
            {active.patient.patientNumber} · {active.visitNumber}
          </p>
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
      <article className="visitSummaryPaper">
        <header>
          <div>
            <p className="eyebrow">{active.facility.name}</p>
            <h1>Visit summary</h1>
            <p>
              {active.facility.code} · Generated {new Date().toLocaleString()}
            </p>
          </div>
          <strong
            className={e?.status === "SIGNED" ? "signedStatus" : "draftStatus"}
          >
            {e?.status === "SIGNED"
              ? "SIGNED CLINICAL RECORD"
              : "DRAFT / INCOMPLETE"}
          </strong>
        </header>
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
        <SummarySection title="Reason for visit and history">
          <p>
            <b>Chief complaint:</b> {display(e?.subjective.chiefComplaint)}
          </p>
          <p>
            <b>Duration:</b> {display(e?.subjective.symptomDuration)}
          </p>
          <p>
            <b>History:</b> {display(e?.subjective.historyPresentingIllness)}
          </p>
          <details>
            <summary>Additional documented history</summary>
            <pre>{display(e?.subjective.reviewOfSystems)}</pre>
            <pre>{display(e?.subjective.pastMedicalHistory)}</pre>
          </details>
        </SummarySection>
        <SummarySection title="Examination">
          <pre>{display(e?.objective.generalExamination)}</pre>
          <pre>{display(e?.objective.systemicExamination)}</pre>
        </SummarySection>
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
        {e?.status === "SIGNED" && <SummarySection title="Signed-note addenda">
          {e.addenda?.length ? e.addenda.map((item: Summary) => <div className="summaryLine" key={item.id}><strong>{new Date(item.createdAt).toLocaleString()} · {item.author.displayName}</strong><span>{item.reason}: {item.text}</span></div>) : <p>No addenda recorded.</p>}
          {canAddendum && <form className="dataForm noPrint" onSubmit={async event => { event.preventDefault(); setSavingAddendum(true); setError(""); const form = new FormData(event.currentTarget); try { const result = await jsonRequest<any>(`/api/encounters/${e.id}/addenda`, { method: "POST", body: JSON.stringify({ reason: form.get("reason"), text: form.get("text") }) }, "Addendum could not be saved"); setActive({ ...active, encounter: { ...e, addenda: [...(e.addenda || []), result.addendum] } }); event.currentTarget.reset(); } catch (reason) { setError((reason as Error).message); } finally { setSavingAddendum(false); } }}><label>Reason *<input name="reason" required minLength={5} placeholder="Correction, clarification, or late information" /></label><label>Addendum *<textarea name="text" required minLength={5} rows={3} placeholder="Add new information without changing the signed note" /></label><button className="secondary" disabled={savingAddendum}>{savingAddendum ? "Adding…" : "Add signed addendum"}</button></form>}
        </SummarySection>}
        <SummarySection title="Investigations">
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
          {verifiedLabs.map((o: Summary) => (
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
          ))}
          {investigations.filter((o: Summary) => o.type === "IMAGING" && o.imaging?.result?.status === "VERIFIED").map((o: Summary) => (
            <div className="reportComment" key={`report-${o.id}`}><strong>{o.displayName} conclusion</strong><p>{o.imaging.result.conclusion}</p><small>Verified by {o.imaging.result.verifiedBy?.displayName || "Imaging service"}</small></div>
          ))}
        </SummarySection>
        <SummarySection title="Medicines">
          {meds.length ? (
            meds.map((o: Summary) => (
              <div className="summaryLine" key={o.id}>
                <strong>{o.displayName}</strong>
                <span>
                  {o.prescription.genericName || o.displayName}{o.prescription.strength ? ` ${o.prescription.strength}` : ""} · {o.prescription.dosageForm || "medicine"} · {o.prescription.dose} · {o.prescription.route} ·{" "}
                  {o.prescription.frequency} · {o.prescription.duration || (o.prescription.stopDate ? `until ${new Date(o.prescription.stopDate).toLocaleDateString()}` : "duration not recorded")}
                  {o.prescription.isPrn ? ` · PRN: ${o.prescription.prnIndication}` : ""}
                  {o.clinicalIndication ? ` · Indication: ${o.clinicalIndication}` : ""}
                  {o.prescription.instructions
                    ? ` · ${o.prescription.instructions}`
                    : ""}{" "}
                  · {o.prescription.dispenseStatus.replaceAll("_", " ")}
                </span>
                {o.prescription.stockMovements?.length ? <small>Batch trace: {o.prescription.stockMovements.map((movement: Summary) => `${movement.batch.batchNumber} (${Math.abs(Number(movement.quantity))}, exp ${new Date(movement.batch.expiryDate).toLocaleDateString()})`).join(" · ")} · Counselling {o.prescription.counsellingCompleted ? "confirmed" : "not confirmed"}</small> : null}
              </div>
            ))
          ) : (
            <p>No medicines prescribed.</p>
          )}
        </SummarySection>
        <SummarySection title="Plan and follow-up">
          <p>{display(e?.plan.plan)}</p>
          <div className="summaryLine">
            <strong>Disposition</strong>
            <span>{display(e?.plan.disposition)}</span>
          </div>
          <div className="summaryLine">
            <strong>Follow-up</strong>
            <span>
              {e?.plan.followUpDate
                ? new Date(e.plan.followUpDate).toLocaleDateString()
                : "Not scheduled"}
            </span>
          </div>
        </SummarySection>
        {active.invoice && (
          <SummarySection title="Billing">
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="summarySection">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
