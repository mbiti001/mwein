"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError, jsonRequest } from "@/lib/client-http";

type RequestSnapshot = { idempotencyKey: string; reason: string; text: string };
export type SavedAddendum = { id: string; encounterId: string; reason: string; text: string; createdAt: string; author: { displayName: string } };

export default function SignedAddendumForm({ encounterId, onSaved }: { encounterId: string; onSaved: (record: SavedAddendum) => void }) {
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<RequestSnapshot | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const dirty = useRef(false);
  dirty.current = Boolean(reason || text || locked);
  useEffect(() => {
    mounted.current = true;
    const guard = (event: Event) => {
      if (!dirty.current && !busy.current) return;
      const message = request.current
        ? "This addendum has not been confirmed. Leaving loses its retry key and does not cancel the save. Check the saved record before entering it again. Leave anyway?"
        : "Discard this unsaved signed-note addendum?";
      if (!window.confirm(message)) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !busy.current) return;
      event.preventDefault(); event.returnValue = true;
    };
    window.addEventListener("mwein:before-workspace-navigation", guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      mounted.current = false;
      window.removeEventListener("mwein:before-workspace-navigation", guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

  return <form className="dataForm addendumEntry noPrint" aria-label="Signed-note addendum" onSubmit={async event => {
    event.preventDefault();
    if (busy.current) return;
    const retrying = Boolean(request.current);
    const snapshot = request.current || { idempotencyKey: crypto.randomUUID(), reason: reason.trim(), text: text.trim() };
    request.current = snapshot;
    busy.current = true; setPending(true); setLocked(true); setError("");
    try {
      const result = await jsonRequest<{ addendum: SavedAddendum }>(`/api/encounters/${encounterId}/addenda`, { method: "POST", body: JSON.stringify(snapshot) }, "Addendum could not be saved");
      if (!result.addendum?.id || result.addendum.encounterId !== encounterId || result.addendum.reason !== snapshot.reason || result.addendum.text !== snapshot.text) throw new Error("The save response could not be confirmed. Retry the unchanged addendum.");
      if (!mounted.current) return;
      onSaved(result.addendum);
      request.current = null; setLocked(false); setReason(""); setText("");
    } catch (failure) {
      if (!mounted.current) return;
      // A definite first-attempt validation/authorization rejection may be edited.
      // After an ambiguous outcome, every retry keeps the original payload/key.
      if (!retrying && failure instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(failure.status)) {
        request.current = null; setLocked(false);
      }
      setError(failure instanceof Error ? failure.message : "Addendum could not be confirmed");
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }}>
    <label>Reason *<input name="reason" required minLength={5} maxLength={240} value={reason} readOnly={locked} onChange={event => setReason(event.target.value)} placeholder="Correction, clarification, or late information" /></label>
    <label>Addendum *<textarea name="text" required minLength={5} maxLength={5000} rows={3} value={text} readOnly={locked} onChange={event => setText(event.target.value)} placeholder="Add new information without changing the signed note" /></label>
    {error && <p role="alert">{error}</p>}
    {locked && !pending && <p role="status">Save not confirmed. Keep this page open and retry the unchanged addendum. Review the saved record before re-entering it elsewhere.</p>}
    <button className="secondary" disabled={pending}>{pending ? "Adding…" : locked ? "Retry unchanged addendum" : "Add signed addendum"}</button>
  </form>;
}
