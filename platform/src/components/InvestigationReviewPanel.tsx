"use client";

import { useWorklist } from "@/lib/use-worklist";
import { isVerifiedResult } from "@/lib/verified-results";

type VerifiedReport = { id: string; status: string; verifiedAt: string | null; verifiedBy: { displayName: string } | null };
type Investigation = {
  id: string; type: string; displayName: string; status: string; priority: string;
  clinicalIndication: string | null; requestedAt: string;
  laboratory: {
    accessionNumber: string | null; specimenType: string; specimenStatus: string;
    collectedAt: string | null; receivedAt: string | null; rejectionReason: string | null;
    result: (VerifiedReport & {
      reportText: string | null; criticalResult: boolean; criticalNotifiedTo: string | null;
      criticalNotifiedAt: string | null; criticalNotificationMethod: string | null; criticalReadBack: boolean;
      criticalConfirmation: string | null; criticalEscalation: string | null;
      items: { id: string; analyte: string; value: string; unit: string | null; referenceRange: string | null; flag: string | null; critical: boolean }[];
    }) | null;
  } | null;
  imaging: { modality: string; result: (VerifiedReport & {
    technique: string | null; findings: string; conclusion: string; recommendations: string | null; performedAt: string;
  }) | null } | null;
};
type InvestigationResponse = {
  visit: { id: string; visitNumber: string; status: string; clinicallyClosedAt: string | null; patient: { fullName: string; patientNumber: string }; orders: Investigation[] };
  truncated: boolean; limit: number;
};
function time(value: string | null) {
  return value ? `${new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} EAT` : "Not recorded";
}
function state(order: Investigation) {
  if (order.status === "CANCELLED") return "Cancelled";
  if (isVerifiedResult(order.laboratory?.result) || isVerifiedResult(order.imaging?.result)) return "Verified report available";
  if (order.status === "COMPLETED") return "Completed — no verified report available";
  if (order.laboratory?.specimenStatus === "REJECTED") return "Specimen rejected — contact laboratory";
  if (order.laboratory?.specimenStatus === "NOT_COLLECTED") return "Awaiting specimen collection";
  if (order.laboratory?.specimenStatus === "COLLECTED") return "Awaiting specimen acceptance";
  return "Awaiting verified report";
}

export default function InvestigationReviewPanel({ visitId }: { visitId: string }) {
  const { data, error, loading, updatedAt, refresh } = useWorklist<InvestigationResponse>(`/api/visits/${visitId}/investigations`);
  const visit = data?.visit.id === visitId ? data.visit : null;
  return <section className="investigationReview span2" aria-label="Investigation results">
    <div className="investigationReviewHeading"><div><h3>Investigations and results</h3><p>Only verified reports are released here. Refresh to check for new results; your consultation notes stay in place.</p></div>
      <button type="button" className="secondary" disabled={loading} onClick={() => void refresh()}>{loading ? "Checking results…" : "Refresh results"}</button>
    </div>
    {error && <p role="alert" className="alert">Results could not be loaded. {error} Use Refresh results to try again.</p>}
    {loading && <p role="status">Loading investigations for this visit…</p>}
    {visit && <>
      <p><strong>{visit.patient.fullName}</strong> · {visit.patient.patientNumber} · {visit.visitNumber}</p>
      <p className="investigationMeta">Checked {time(updatedAt?.toISOString() || null)}. Opening a report does not record clinical acknowledgement.</p>
      {(visit.clinicallyClosedAt || ["COMPLETED", "CANCELLED"].includes(visit.status)) && <p role="status">This visit is closed. Reports remain available for reading.</p>}
      {data?.truncated && <p role="status" className="alert">Showing the latest {data.limit} investigations. Older requests remain in the clinical record; this is not a complete outstanding-work count.</p>}
      {!visit.orders.length && <p>No investigations requested for this visit.</p>}
      {visit.orders.map(order => {
        const lab = isVerifiedResult(order.laboratory?.result) ? order.laboratory.result : null;
        const imaging = isVerifiedResult(order.imaging?.result) ? order.imaging.result : null;
        const report = lab || imaging;
        return <article className="investigationItem" key={order.id}>
          <h4>{order.displayName}</h4><p><strong>{state(order)}</strong> · {order.priority} · Requested {time(order.requestedAt)}</p>
          {order.clinicalIndication && <p>Indication: {order.clinicalIndication}</p>}
          {order.laboratory && <p className="investigationMeta">{order.laboratory.specimenType} · Accession {order.laboratory.accessionNumber || "not assigned"} · Collected {time(order.laboratory.collectedAt)} · Received {time(order.laboratory.receivedAt)}{order.laboratory.rejectionReason ? ` · Rejection: ${order.laboratory.rejectionReason}` : ""}</p>}
          {order.status !== "CANCELLED" && report && <details>
            <summary>Read verified report · {order.displayName}</summary>
            <p>Verified {time(report.verifiedAt)} · {report.verifiedBy?.displayName || "Verifier not recorded"}</p>
            {lab && <>
              {lab.criticalResult && <div className="alert"><strong>Critical result</strong><p>Recorded notification: {lab.criticalNotifiedTo || "not recorded"} · {time(lab.criticalNotifiedAt)} · {lab.criticalNotificationMethod?.replaceAll("_", " ") || "method not recorded"} · Read-back {lab.criticalReadBack ? "confirmed" : "not recorded"}</p>{lab.criticalConfirmation && <p>{lab.criticalConfirmation}</p>}{lab.criticalEscalation && <p>Escalation: {lab.criticalEscalation}</p>}</div>}
              <div className="investigationTable" tabIndex={0} role="region" aria-label={`${order.displayName} result values`}><table className="reportResults"><thead><tr><th>Analyte</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead><tbody>{lab.items.map(item => <tr key={item.id}><th>{item.analyte}</th><td>{item.value}</td><td>{item.unit || "—"}</td><td>{item.referenceRange || "Not supplied"}</td><td>{item.flag || "—"}{item.critical ? " · Critical" : ""}</td></tr>)}</tbody></table></div>
              {lab.reportText && <p className="investigationNarrative">{lab.reportText}</p>}
            </>}
            {imaging && <div className="investigationNarrative"><p>Performed {time(imaging.performedAt)} · {order.imaging?.modality}</p>{imaging.technique && <p><strong>Technique:</strong> {imaging.technique}</p>}<p><strong>Findings:</strong> {imaging.findings}</p><p><strong>Conclusion:</strong> {imaging.conclusion}</p>{imaging.recommendations && <p><strong>Recommendations:</strong> {imaging.recommendations}</p>}</div>}
          </details>}
        </article>;
      })}
    </>}
  </section>;
}
