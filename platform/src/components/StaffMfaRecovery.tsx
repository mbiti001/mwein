"use client";
import { useState, type FormEvent } from "react";
import { jsonRequest } from "@/lib/client-http";

export default function StaffMfaRecovery({ userId, onRecovered }: { userId: string; onRecovered: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError("");
    try {
      await jsonRequest(`/api/admin/users/${userId}/mfa-recovery`, { method: "POST", body: JSON.stringify({ identityCheckReference: values.get("identityCheckReference"), temporaryPassword: values.get("temporaryPassword"), identityChecked: values.get("identityChecked") === "on" }) });
      form.reset(); await onRecovered();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  return <details className="managementBody"><summary>Recover lost authenticator and recovery codes</summary>
    <p>Use only after checking this person's identity through the facility recovery procedure. Your own MFA sign-in must be within five minutes. This revokes their sessions, authenticator and recovery codes, and requires a new password and MFA enrollment.</p>
    <form className="dataForm" onSubmit={submit}>
      {error && <p className="alert wide" role="alert">{error}</p>}
      <label>Identity-check record reference<input name="identityCheckReference" minLength={8} maxLength={160} required placeholder="Reference only; no identity document contents" /></label>
      <label>Recovery temporary password<input name="temporaryPassword" type="password" autoComplete="new-password" minLength={16} maxLength={256} required /></label>
      <label className="wide"><input name="identityChecked" type="checkbox" required /> I checked the staff member's identity and recorded the evidence securely</label>
      <button className="secondary" disabled={busy}>{busy ? "Recovering…" : "Revoke lost factors and require new enrollment"}</button>
    </form>
  </details>;
}
