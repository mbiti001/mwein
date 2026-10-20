"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { jsonRequest } from "@/lib/client-http";
import {
  shaCancellationOutcomes,
  visitCancellationReasons,
  type VisitCancellationPreview,
} from "@/lib/visit-cancellation";

export type CancellationTarget = {
  id: string;
  visitNumber: string;
  patient: { id: string; fullName: string; patientNumber: string };
};

export default function VisitCancellationDialog({ visit, onClose, onCancelled }: {
  visit: CancellationTarget;
  onClose: () => void;
  onCancelled: (visit: CancellationTarget) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [reasonCode, setReasonCode] = useState("");
  const [details, setDetails] = useState("");
  const [shaOutcome, setShaOutcome] = useState("");
  const [shaEligibilityReference, setShaEligibilityReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [review, setReview] = useState<{ reason: string; value: VisitCancellationPreview } | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const effectiveReason = reasonCode || "PATIENT_REQUEST";
  const preview = review?.reason === effectiveReason ? review.value : null;
  const isSha = reasonCode === "SHA_BENEFIT_OR_ELIGIBILITY";
  const isCoverReason = isSha || reasonCode === "PRIVATE_COVER_NOT_AVAILABLE";

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setReview(null);
    setReviewError("");
    jsonRequest<VisitCancellationPreview>(
      "/api/visits/" + visit.id + "/cancel?reasonCode=" + encodeURIComponent(effectiveReason),
      { signal: controller.signal, cache: "no-store" },
    ).then(value => {
      if (!controller.signal.aborted) setReview({ reason: effectiveReason, value });
    }).catch(error => {
      if (!controller.signal.aborted) setReviewError((error as Error).message);
    });
    return () => controller.abort();
  }, [visit.id, effectiveReason, reviewVersion]);

  const canSubmit = !!preview?.canCancel && !!reasonCode && details.trim().length >= 5
    && confirmed && (!isSha || (!!shaOutcome && shaEligibilityReference.trim().length >= 3));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting.current || completed) return;
    submitting.current = true;
    setBusy(true);
    setSubmissionError("");
    try {
      await jsonRequest("/api/visits/" + visit.id + "/cancel", {
        method: "POST",
        body: JSON.stringify({
          reasonCode,
          details: details.trim(),
          ...(isSha ? { shaOutcome, shaEligibilityReference: shaEligibilityReference.trim() } : {}),
        }),
      });
    } catch (error) {
      setSubmissionError((error as Error).message);
      setConfirmed(false);
      setReviewVersion(value => value + 1);
      submitting.current = false;
      setBusy(false);
      return;
    }

    // A successful mutation stays successful even if refreshing the worklist fails.
    setCompleted(true);
    try {
      await onCancelled(visit);
    } catch {
      setSubmissionError("Cancellation was recorded. Refresh the visit list to see the latest queue.");
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="visitCancellationDialog"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="cancellationHeading">
      <div><p className="eyebrow">Visit management</p><h2 id={titleId}>Cancel visit</h2></div>
      <Button variant="secondary" onClick={onClose} disabled={busy} aria-label="Close cancellation review">Close</Button>
    </div>
    <div className="cancellationIdentity">
      <strong>{preview?.patient.fullName || visit.patient.fullName}</strong>
      <span>{preview?.patient.patientNumber || visit.patient.patientNumber} · {preview?.visitNumber || visit.visitNumber}</span>
    </div>
    <p id={descriptionId}>Review the correct patient and visit before confirming. The patient record and cancellation history are retained.</p>
    {completed ? <p className="alert success" role="status">The visit was cancelled.</p> : <form onSubmit={submit} className="cancellationForm">
      {!preview && !reviewError && <p role="status">Checking the latest visit, care and billing status…</p>}
      {reviewError && <div className="alert" role="alert">
        <p>{reviewError}</p>
        <Button variant="secondary" onClick={() => setReviewVersion(value => value + 1)}>Retry visit check</Button>
      </div>}
      {preview && !preview.canCancel && <div className="alert cancellationBlockers" role="status">
        <strong>This visit cannot be cancelled</strong>
        <ul>{preview.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
      </div>}
      {preview?.canCancel && <section className="cancellationImpact" aria-label="Cancellation effects">
        <h3>What will happen</h3>
        <ul>
          <li>The visit will be marked Cancelled and removed from active worklists.</li>
          <li>{preview.impact.activeQueues} active queue task(s) will close.</li>
          {preview.impact.pendingOrders > 0 && <li>{preview.impact.pendingOrders} unstarted order(s) will be cancelled.</li>}
          {preview.impact.voidInvoice && <li>The unpaid invoice will be voided; its entries will be retained.</li>}
          {preview.impact.draftClaims > 0 && <li>{preview.impact.draftClaims} draft claim(s) will be cancelled.</li>}
          {preview.impact.cancelAppointment && <li>The linked appointment will be marked Cancelled.</li>}
          <li>Your name, the time and the documented reason will be recorded.</li>
        </ul>
      </section>}
      <label>Cancellation reason
        <select required value={reasonCode} disabled={busy} onChange={event => {
          setReasonCode(event.target.value);
          setShaOutcome("");
          setShaEligibilityReference("");
          setConfirmed(false);
          setSubmissionError("");
        }}>
          <option value="">Select a reason</option>
          {visitCancellationReasons.map(reason => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
        </select>
      </label>
      {isCoverReason && <p className="shaCareWarning">Eligibility and benefit checks must not delay emergency assessment or stabilisation.</p>}
      {isSha && <div className="cancellationFields">
        <label>SHA outcome
          <select required value={shaOutcome} disabled={busy} onChange={event => setShaOutcome(event.target.value)}>
            <option value="">Select the verified outcome</option>
            {shaCancellationOutcomes.map(outcome => <option key={outcome.code} value={outcome.code}>{outcome.label}</option>)}
          </select>
        </label>
        <label>SHA check / verification reference
          <input required minLength={3} maxLength={120} value={shaEligibilityReference} disabled={busy}
            onChange={event => setShaEligibilityReference(event.target.value)} placeholder="Verification reference" />
        </label>
      </div>}
      <label>Cancellation explanation
        <textarea required minLength={5} maxLength={500} rows={3} value={details} disabled={busy}
          onChange={event => setDetails(event.target.value)} placeholder="What happened, attendance review, and the agreed next step" />
      </label>
      <label className="cancellationConfirmation">
        <input type="checkbox" required checked={confirmed} disabled={busy || !preview?.canCancel}
          onChange={event => setConfirmed(event.target.checked)} />
        <span>I confirm this is the correct visit and only unstarted services will be cancelled.</span>
      </label>
      {submissionError && <p className="alert" role="alert">{submissionError}</p>}
      <div className="cancellationFooter">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Keep visit</Button>
        <Button variant="danger" type="submit" disabled={!canSubmit} pending={busy} pendingLabel="Cancelling…">Confirm cancellation</Button>
      </div>
    </form>}
    {completed && submissionError && <p role="status">{submissionError}</p>}
  </dialog>;
}
