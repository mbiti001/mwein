"use client";

import { useState, type FormEvent } from "react";
import { jsonRequest } from "@/lib/client-http";

type Action = "START" | "VERIFY" | "REPLACE" | "RECOVERY_CODES";
export default function MfaWorkstation({ enrolled, required, onCompleted }: { enrolled: boolean; required: boolean; onCompleted: () => Promise<void> }) {
  const [action, setAction] = useState<Action | null>(required && enrolled ? "VERIFY" : !enrolled ? "START" : null);
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    setBusy(true); setError("");
    try {
      const result = await jsonRequest<{ secret?: string; qrCode?: string; recoveryCodes?: string[] }>("/api/auth/mfa", {
        method: "POST", body: JSON.stringify(setup ? { action: "CONFIRM", code: fields.get("code") } : { action, password: fields.get("password") || undefined, code: fields.get("code") || undefined }),
      });
      form.reset();
      if (result.secret && result.qrCode) { setSetup({ secret: result.secret, qrCode: result.qrCode }); return; }
      setSetup(null);
      if (result.recoveryCodes) { setRecoveryCodes(result.recoveryCodes); setSavedCodes(false); return; }
      await onCompleted();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function signOut() { await jsonRequest("/api/auth/logout", { method: "POST" }); location.reload(); }
  return <section className={required ? "login" : "mfaSettings"} aria-label="Multi-factor authentication"><div className="formCard mfaCard">
    <div><p className="eyebrow">Account security</p><h1>{recoveryCodes ? "Save your recovery codes" : setup ? "Connect your authenticator" : action === "VERIFY" ? "Verify your sign-in" : action === "REPLACE" ? "Replace your authenticator" : action === "RECOVERY_CODES" ? "Generate new recovery codes" : enrolled ? "Multi-factor authentication" : "Set up multi-factor authentication"}</h1></div>
    {error && <p className="alert" role="alert">{error}</p>}
    {recoveryCodes ? <>
      <p>MFA is enabled. Each code can be used once if you lose access to your authenticator. Store these somewhere private and separate from this device. They are shown only now; any older recovery codes have been replaced.</p>
      <pre className="mfaRecovery" aria-label="Recovery codes">{recoveryCodes.join("\n")}</pre>
      <label className="mfaCheck"><input type="checkbox" checked={savedCodes} onChange={event => setSavedCodes(event.target.checked)} /> I have saved my recovery codes securely</label>
      <button className="primary" disabled={!savedCodes || busy} onClick={async () => { setBusy(true); try { await onCompleted(); } finally { setBusy(false); } }}>Continue to workspace</button>
    </> : action || setup ? <form className="mfaForm" onSubmit={submit}>
      {setup ? <>
        <p>Scan this QR code in Google Authenticator or another compatible authenticator app, then enter its six-digit code. Setup expires after 10 minutes.</p>
        {/* This QR is generated locally on our server; no authenticator secret goes to a QR service. */}
        <img className="mfaQr" src={setup.qrCode} width={240} height={240} alt="Authenticator setup QR code" />
        <details><summary>Enter a setup key manually</summary><label>Authenticator setup key<input value={setup.secret} readOnly autoComplete="off" /></label><p>Use time-based codes, six digits, changing every 30 seconds.</p></details>
      </> : action === "VERIFY" ? <p>Enter the six-digit code from your authenticator, or one unused recovery code. Your password alone cannot open patient records.</p> : action === "START" ? <p>Protect your staff account using Google Authenticator or another compatible authenticator app. Confirm your current password to begin.</p> : <p>Confirm your password and an unused authenticator or recovery code. {action === "REPLACE" ? "Your existing authenticator stays active until you confirm the new one." : "This replaces every previous recovery code."}</p>}
      {!setup && action !== "VERIFY" && <label>Current password<input type="password" name="password" autoComplete="current-password" maxLength={256} required /></label>}
      {(setup || action !== "START") && <label>{setup ? "Six-digit authenticator code" : "Authenticator or recovery code"}<input name="code" autoComplete="one-time-code" inputMode={setup ? "numeric" : "text"} maxLength={80} required /></label>}
      <button className="primary" disabled={busy}>{busy ? "Verifying…" : setup ? "Confirm authenticator" : action === "VERIFY" ? "Verify and sign in" : action === "START" ? "Start MFA setup" : action === "REPLACE" ? "Start replacement" : "Generate recovery codes"}</button>
    </form> : <>
      <p>Your account requires an authenticator or recovery code at every sign-in. Password resets do not remove MFA.</p>
      <button className="secondary" onClick={() => setAction("REPLACE")}>Replace authenticator</button>
      <button className="secondary" onClick={() => setAction("RECOVERY_CODES")}>Generate new recovery codes</button>
    </>}
    <p>Never share authenticator or recovery codes. If both are lost, contact the facility administrator for identity-verified recovery.</p>
    {required && <button className="secondary" disabled={busy} onClick={() => void signOut()}>Sign out</button>}
  </div></section>;
}
