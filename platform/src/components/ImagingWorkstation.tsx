"use client";
import { useEffect, useMemo, useState } from "react";
type Visit = any;
export default function ImagingWorkstation({
  visits,
  onUpdated,
  initialVisitId,
  onInitialVisitOpened,
}: {
  visits: Visit[];
  onUpdated: () => Promise<void>;
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
}) {
  const queue = useMemo(
    () =>
      visits.flatMap((v) =>
        (v.orders || [])
          .filter(
            (o: Visit) => o.type === "IMAGING" && o.status !== "CANCELLED",
          )
          .map((order: Visit) => ({ visit: v, order })),
      ),
    [visits],
  );
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!initialVisitId) return;
    const target = queue.find((item: Visit) => item.visit.id === initialVisitId && item.order.status !== "COMPLETED");
    if (target) { setActive(target); onInitialVisitOpened?.(); }
  }, [initialVisitId, queue, onInitialVisitOpened]);
  async function submit(form: HTMLFormElement, action: string) {
    if (!active) return;
    setBusy(true);
    setError("");
    const f = new FormData(form);
    try {
      const response = await fetch(
        `/api/orders/${active.order.id}/imaging-result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            technique: f.get("technique") || undefined,
            findings: f.get("findings") || undefined,
            conclusion: f.get("conclusion") || undefined,
            recommendations: f.get("recommendations") || undefined,
            performedAt: f.get("performedAt") || undefined,
            reason: f.get("reason") || undefined,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Imaging report could not be saved");
      await onUpdated();
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!active)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Imaging workstation</p>
            <h1>Imaging worklist</h1>
            <p>
              Perform examinations, document findings and release verified
              reports.
            </p>
          </div>
        </header>
        <section className="card">
          {queue.length ? (
            <div className="queue">
              {queue.map(({ visit: v, order: o }) => (
                <button
                  className={`row ${v.priority.toLowerCase()}`}
                  onClick={() => setActive({ visit: v, order: o })}
                  key={o.id}
                >
                  <span className="dot" />
                  <div>
                    <strong>{v.patient.fullName}</strong>
                    <small>
                      {v.patient.patientNumber} · {o.displayName} ·{" "}
                      {o.imaging?.modality}
                    </small>
                  </div>
                  <b>{o.status.replaceAll("_", " ")}</b>
                  <time>{v.visitNumber}</time>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <strong>No imaging orders</strong>
              <p>Submitted imaging requests appear here automatically.</p>
            </div>
          )}
        </section>
      </>
    );
  const { visit, order } = active;
  const report = order.imaging?.result;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Imaging report</p>
          <h1>{order.displayName}</h1>
          <p>
            {visit.patient.fullName} · {visit.patient.patientNumber} ·{" "}
            {visit.visitNumber}
          </p>
        </div>
        <button className="secondary" onClick={() => setActive(null)}>
          ← Worklist
        </button>
      </header>
      {error && <div className="alert">{error}</div>}
      {report?.status === "VERIFIED" ? (
        <article className="visitSummaryPaper">
          <header>
            <div>
              <p className="eyebrow">{visit.facility?.name}</p>
              <h1>Verified imaging report</h1>
              <p>
                {order.imaging.modality} · {order.displayName}
              </p>
            </div>
            <button className="primary noPrint" onClick={() => window.print()}>
              Print / Save PDF
            </button>
          </header>
          <section className="summaryIdentity">
            <div>
              <small>Patient</small>
              <strong>{visit.patient.fullName}</strong>
              <span>{visit.patient.patientNumber}</span>
            </div>
            <div>
              <small>Visit</small>
              <strong>{visit.visitNumber}</strong>
            </div>
            <div>
              <small>Performed</small>
              <strong>{new Date(report.performedAt).toLocaleString()}</strong>
              <span>{report.performedBy?.displayName}</span>
            </div>
            <div>
              <small>Verified</small>
              <strong>{new Date(report.verifiedAt).toLocaleString()}</strong>
              <span>{report.verifiedBy?.displayName}</span>
            </div>
          </section>
          <section className="summarySection">
            <h2>Technique</h2>
            <p>{report.technique || "Not stated"}</p>
          </section>
          <section className="summarySection">
            <h2>Findings</h2>
            <p>{report.findings}</p>
          </section>
          <section className="summarySection">
            <h2>Conclusion</h2>
            <p>{report.conclusion}</p>
          </section>
          {report.recommendations && (
            <section className="summarySection">
              <h2>Recommendation</h2>
              <p>{report.recommendations}</p>
            </section>
          )}
        </article>
      ) : (
        <form
          className="card dataForm"
          onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget, "SAVE_DRAFT"); }}
        >
          <label>
            Performed date and time
            <input
              name="performedAt"
              type="datetime-local"
              defaultValue={
                report?.performedAt?.slice(0, 16) ||
                new Date().toISOString().slice(0, 16)
              }
            />
          </label>
          <label>
            Technique
            <textarea
              name="technique"
              rows={2}
              defaultValue={report?.technique || ""}
            />
          </label>
          <label className="wide">
            Findings *
            <textarea
              name="findings"
              rows={7}
              required
              defaultValue={report?.findings || ""}
            />
          </label>
          <label className="wide">
            Conclusion / impression *
            <textarea
              name="conclusion"
              rows={3}
              required
              defaultValue={report?.conclusion || ""}
            />
          </label>
          <label className="wide">
            Recommendations
            <textarea
              name="recommendations"
              rows={2}
              defaultValue={report?.recommendations || ""}
            />
          </label>
          <label className="wide">
            Cancellation reason
            <input
              name="reason"
              placeholder="Required only if examination is cancelled"
            />
          </label>
          <div className="wide submitBar">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={(e) => submit(e.currentTarget.form!, "CANCEL")}
            >
              Cancel examination
            </button>
            <div>
              <button className="secondary" disabled={busy}>
                Save draft
              </button>{" "}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={(e) => submit(e.currentTarget.form!, "VERIFY")}
              >
                Verify & release
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
