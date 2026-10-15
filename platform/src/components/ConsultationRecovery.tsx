"use client";

import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/lib/client-http";
import type { ConsultationVisit } from "./ConsultationWorkstation";

type Snapshot = Pick<ConsultationVisit, "id" | "status" | "encounters"> & { clinicallyClosedAt?: string | null };

function fields(value?: string | null): [string, string][] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return Object.entries(parsed).flatMap(([key, item]): [string, string][] => {
        if (key === "complaints" && Array.isArray(item)) return item.map((complaint, index) => [`Complaint ${index + 1}`, [complaint.complaint, complaint.durationValue ? `${complaint.durationValue} ${complaint.durationUnit || "(unit not recorded)"}` : complaint.legacyDuration].filter(Boolean).join(" · ")]);
        return typeof item === "string" && item.trim() ? [[key.replace(/([a-z])([A-Z])/g, "$1 $2"), item]] : [];
      });
  } catch { /* Older narrative notes remain readable. */ }
  return [["Recorded text", value]];
}

export default function ConsultationRecovery({ visitId, onLoad }: { visitId: string; onLoad: (snapshot: Snapshot) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [visitId]);
  async function review() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setSnapshot(null); setError(""); setBusy(true);
    try {
      const result = await jsonRequest<{ visit: Snapshot }>(`/api/visits/${visitId}/consultation`, { signal: request.signal });
      if (!request.signal.aborted) setSnapshot(result.visit);
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  const encounter = snapshot?.encounters?.[0];
  const editable = snapshot && !snapshot.clinicallyClosedAt && !["CANCELLED", "COMPLETED", "DISCHARGED"].includes(snapshot.status || "") && (!encounter || encounter.status === "DRAFT");
  return <section className="clinicalBoundary noPrint" style={{ display: "block", minWidth: 0 }} aria-label="Saved consultation recovery">
    <strong>Review the saved consultation</strong>
    <p>Your current form stays unchanged while you review. Unsaved text is held only in this open form; it is not saved on this device.</p>
    <button type="button" className="secondary" disabled={busy} onClick={review}>{busy ? "Loading saved notes…" : "Review latest saved notes"}</button>
    {error && <p role="alert">{error}</p>}
    {snapshot && <div>
      <p>{encounter ? `${encounter.status} · Encounter clinician: ${encounter.clinician?.displayName || "Not recorded"} · Updated: ${encounter.updatedAt ? new Date(encounter.updatedAt).toLocaleString() : "Not recorded"}` : "No saved consultation notes."}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))", gap: "1rem" }}>
        {[["History", encounter?.subjective], ["Examination", encounter?.objective], ["Plan", encounter?.plan]].map(([heading, value]) => <div key={heading}>
          <strong>{heading}</strong>
          <dl>{fields(value).map(([label, text]) => <div key={label} style={{ marginBottom: ".65rem" }}><dt style={{ textTransform: "capitalize" }}>{label}</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</dd></div>)}</dl>
          {!fields(value).length && <p>Not recorded</p>}
        </div>)}
      </div>
      <p>Recorded diagnoses: {encounter?.diagnoses?.map(item => `${item.code || "Code not recorded"} · ${item.description}${item.primary ? " (primary)" : ""}`).join("; ") || "Not recorded"}</p>
      {editable ? <button type="button" className="secondary" onClick={() => {
        if (window.confirm("Replace your current form with this saved version? Any unsaved entries in this form will be discarded.")) onLoad(snapshot);
      }}>Replace my form with this saved version</button> : <p>This consultation is signed or the visit is closed. Its notes cannot be replaced here.</p>}
    </div>}
  </section>;
}
