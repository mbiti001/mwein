"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  allowedClaimStatuses,
  type ClaimStatus,
} from "@/lib/billing";
import { jsonRequest } from "@/lib/client-http";
import CashierShiftPanel from "@/components/CashierShiftPanel";
import { FacilityLetterhead } from "@/components/FacilityBrand";
type Visit = {
  id: string;
  visitNumber: string;
  status: string;
  priority: string;
  facility?: { name: string; code: string };
  patient: { fullName: string; patientNumber: string };
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    items: {
      id: string;
      serviceCode: string;
      description: string;
      quantity: string;
      unitPrice: string;
    }[];
    payments: {
      id: string;
      method: string;
      status: string;
      amount: string;
      externalReference?: string | null;
      receivedAt: string;
      receipt?: { receiptNumber: string; issuedAt: string } | null;
    }[];
    claims: {
      id: string;
      payer: string;
      memberNumber: string;
      claimNumber: string;
      amount: string;
      status: string;
      notes?: string | null;
      shaPreparation?: {
        fund?: string;
        contractVersion?: string;
        preparationOnly?: boolean;
        eligibilityReference?: string;
        referralReference?: string;
        preauthorisationRequired?: boolean;
        preauthorisationReference?: string;
        emergency?: boolean;
        emergencyNotificationReference?: string;
        emergencyNotificationDueAt?: string | null;
        pomsfEmployerId?: string;
        publicServiceGrade?: string;
        readinessIssues?: { code: string; message: string }[];
      } | null;
      createdAt: string;
      lines?: { invoiceItemId: string; amount: string }[];
    }[];
  } | null;
};
const money = (value: number, currency = "KES") =>
  `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function emergencyDeadline(preparation: NonNullable<NonNullable<Visit["invoice"]>["claims"][number]["shaPreparation"]>, now: number) {
  if (!preparation.emergency) return null;
  if (preparation.emergencyNotificationReference) return { state: "RECORDED", text: `Emergency notification recorded · ${preparation.emergencyNotificationReference}` };
  if (!preparation.emergencyNotificationDueAt) return { state: "DUE", text: "Emergency notification deadline was not recorded" };
  const dueAt = new Date(preparation.emergencyNotificationDueAt);
  const remainingMs = dueAt.getTime() - now;
  const hours = Math.max(1, Math.ceil(Math.abs(remainingMs) / (60 * 60 * 1000)));
  return remainingMs < 0
    ? { state: "OVERDUE", text: `Emergency SHA notification overdue by ${hours} hour${hours === 1 ? "" : "s"}` }
    : { state: "DUE", text: `Emergency SHA notification due in ${hours} hour${hours === 1 ? "" : "s"} · ${dueAt.toLocaleString()}` };
}
export default function BillingWorkstation({
  visits,
  permissions,
  onUpdated,
  initialVisitId,
  onInitialVisitOpened,
}: {
  visits: Visit[];
  permissions: string[];
  onUpdated: () => Promise<void>;
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
}) {
  const queue = useMemo(() => visits.filter((v) => v.invoice && ["AWAITING_PAYMENT", "DISCHARGED", "REFERRED"].includes(v.status)), [visits]);
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState("");
  const [claimPayer, setClaimPayer] = useState("SHA");
  const [shaFund, setShaFund] = useState("PHF");
  const [shaEmergency, setShaEmergency] = useState(false);
  const [shaPreauthorisationRequired, setShaPreauthorisationRequired] = useState(false);
  const [query, setQuery] = useState("");
  const visibleQueue = useMemo(() => {
    const term = query.trim().toLowerCase();
    return queue.filter(v => !term || `${v.patient.fullName} ${v.patient.patientNumber} ${v.visitNumber} ${v.invoice?.invoiceNumber || ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [queue, query]);
  const [shaReadiness, setShaReadiness] = useState<{
    ready: boolean;
    contract: { phase: string; activationReady: boolean; draftVersion: string };
  } | null>(null);
  const shaReady = Boolean(shaReadiness?.ready);
  useEffect(() => { void jsonRequest<{ ready: boolean; contract: { phase: string; activationReady: boolean; draftVersion: string } }>("/api/integrations/sha/readiness", undefined, "SHA readiness could not be checked").then(setShaReadiness).catch(() => setShaReadiness(null)); }, []);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const emergencyNotifications = useMemo(() => {
    const actions: { visit: Visit; claimNumber: string; deadline: { state: string; text: string } }[] = [];
    for (const visit of visits) {
      for (const claim of visit.invoice?.claims || []) {
        if (!claim.shaPreparation) continue;
        const deadline = emergencyDeadline(claim.shaPreparation, clock);
        if (deadline && deadline.state !== "RECORDED") actions.push({ visit, claimNumber: claim.claimNumber, deadline });
      }
    }
    return actions.sort((left, right) => left.deadline.state === "OVERDUE" ? -1 : right.deadline.state === "OVERDUE" ? 1 : 0);
  }, [visits, clock]);
  const [receiptView, setReceiptView] = useState<{
    visit: Visit;
    payment: any;
  } | null>(null);
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = queue.find(item => item.id === initialVisitId);
    if (visit) { setActive(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, queue, onInitialVisitOpened]);
  const invoice = active?.invoice;
  const total =
    invoice?.items.reduce(
      (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
      0,
    ) || 0;
  const paid =
    invoice?.payments
      .filter((p) => p.status === "CONFIRMED")
      .reduce((s, p) => s + Number(p.amount), 0) || 0;
  const claimed = invoice?.claims.filter(c => ["DRAFT", "SUBMITTED", "APPROVED", "PAID"].includes(c.status)).reduce((sum, c) => sum + Number(c.amount), 0) || 0;
  const balance = Math.max(0, total - paid - claimed);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const data = await jsonRequest<any>(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          method: form.get("method"),
          amount: form.get("amount"),
          externalReference: form.get("externalReference") || undefined,
        }),
      }, "Payment could not be recorded");
      setLastReceipt(data.payment.receipt?.receiptNumber || "");
      setReceiptView({ visit: active, payment: data.payment });
      await onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const payer = String(f.get("payer"));
    const optional = (name: string) => String(f.get(name) || "").trim() || undefined;
    try {
      const d = await jsonRequest<any>(`/api/invoices/${invoice.id}/claims`, {
          method: "POST",
          body: JSON.stringify({
            payer,
            memberNumber: f.get("memberNumber"),
            coveredItemIds: f.getAll("coveredItemIds"),
            notes: f.get("claimNotes") || undefined,
            submit: payer === "SHA" ? shaReady : true,
            shaPreparation: payer === "SHA" ? {
              fund: f.get("shaFund"),
              emergency: f.get("shaEmergency") === "on",
              eligibilityReference: optional("shaEligibilityReference"),
              referralReference: optional("shaReferralReference"),
              preauthorisationRequired: f.get("shaPreauthorisationRequired") === "on",
              preauthorisationReference: optional("shaPreauthorisationReference"),
              emergencyNotificationReference: optional("shaEmergencyNotificationReference"),
              pomsfEmployerId: optional("shaPomsfEmployerId"),
              publicServiceGrade: optional("shaPublicServiceGrade"),
            } : undefined,
          }),
        }, "Claim could not be created");
      setLastReceipt(`Claim ${d.claim.claimNumber} ${d.claim.status === "DRAFT" ? "saved as draft; visit remains awaiting submission" : d.visitCompleted ? "submitted; visit completed" : "submitted; collect any patient-pay balance before completing the visit"}`);
      await onUpdated();
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reverse(paymentId: string, reason: string) {
    if (reason.trim().length < 5)
      return setError("Enter a clear reversal reason");
    setBusy(true);
    setError("");
    try {
      await jsonRequest(`/api/payments/${paymentId}/reverse`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }, "Payment could not be reversed");
      await onUpdated();
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function completeVisit() {
    if (!active) return;
    setBusy(true); setError("");
    try {
      await jsonRequest(`/api/visits/${active.id}/complete`, { method: "POST" }, "Visit could not be completed");
      setLastReceipt(`${active.visitNumber} completed and removed from active patient flow.`);
      setActive(null);
      await onUpdated();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function updateClaim(
    event: FormEvent<HTMLFormElement>,
    claimId: string,
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await jsonRequest<any>(`/api/claims/${claimId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: form.get("status"),
          notes: form.get("notes"),
        }),
      }, "Claim status could not be updated");
      setLastReceipt(`Claim ${data.claim.claimNumber} marked ${data.claim.status}`);
      await onUpdated();
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (receiptView) {
    const v = receiptView.visit,
      p = receiptView.payment;
    return (
      <>
        <header className="noPrint">
          <div>
            <p className="eyebrow">Payment receipt</p>
            <h1>{p.receipt.receiptNumber}</h1>
          </div>
          <div>
            <button
              className="secondary"
              onClick={() => {
                setReceiptView(null);
                setActive(null);
              }}
            >
              ← Billing
            </button>{" "}
            <button className="primary" onClick={() => window.print()}>
              Print receipt
            </button>
          </div>
        </header>
        <article className="visitSummaryPaper receiptPaper">
          <FacilityLetterhead
            facilityName={v.facility?.name}
            title="Official receipt"
            reference={p.receipt.receiptNumber}
            badge={<strong className="signedStatus">PAID</strong>}
          />
          <section className="summaryIdentity">
            <div>
              <small>Received from</small>
              <strong>{v.patient.fullName}</strong>
              <span>{v.patient.patientNumber}</span>
            </div>
            <div>
              <small>Invoice</small>
              <strong>{v.invoice!.invoiceNumber}</strong>
              <span>{v.visitNumber}</span>
            </div>
            <div>
              <small>Payment method</small>
              <strong>{p.method}</strong>
              <span>{p.externalReference || "—"}</span>
            </div>
            <div>
              <small>Date</small>
              <strong>{new Date(p.receivedAt).toLocaleString()}</strong>
            </div>
          </section>
          <div className="receiptAmount">
            <small>Amount received</small>
            <strong>{money(Number(p.amount), v.invoice!.currency)}</strong>
          </div>
          <footer>
            <p>Computer-generated receipt. Payment reference: {p.reference}</p>
          </footer>
        </article>
      </>
    );
  }
  if (!active || !invoice)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Billing workstation</p>
            <h1>Invoices awaiting settlement</h1>
            <p>
              Review automatically generated charges, receive payment and close
              eligible visits.
            </p>
          </div>
        </header>
        {lastReceipt && (
          <div className="alert success">
            Payment recorded · Receipt {lastReceipt}
          </div>
        )}
        {permissions.includes("billing.write") && <CashierShiftPanel permissions={permissions} />}
        {emergencyNotifications.length > 0 && <section className="card"><div className="cardHead"><div><h2>SHA emergency notifications</h2><p>Draft Part B3 requires emergency care to proceed without delay and notification to SHA within 24 hours.</p></div><strong>{emergencyNotifications.length}</strong></div><div className="queue">{emergencyNotifications.map(action => <button className={`row ${action.deadline.state === "OVERDUE" ? "urgent" : "priority"}`} type="button" onClick={() => setActive(action.visit)} key={action.claimNumber}><span className="dot"/><div><strong>{action.visit.patient.fullName} · {action.claimNumber}</strong><small>{action.deadline.text}</small></div><b>Open claim</b></button>)}</div></section>}
        <section className="card">
          <label className="listSearch">Find a visit<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Patient, patient number, visit or invoice" /></label>
          {visibleQueue.length ? (
            <div className="queue">
              {visibleQueue.map((v) => {
                const t = v.invoice!.items.reduce(
                    (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
                    0,
                  ),
                  p = v
                    .invoice!.payments.filter((i) => i.status === "CONFIRMED")
                    .reduce((s, i) => s + Number(i.amount), 0);
                return (
                  <button
                    className={`row ${v.priority.toLowerCase()}`}
                    onClick={() => setActive(v)}
                    key={v.id}
                  >
                    <span className="dot" />
                    <div>
                      <strong>{v.patient.fullName}</strong>
                      <small>
                        {v.patient.patientNumber} · {v.invoice!.invoiceNumber} ·{" "}
                        {v.status.replaceAll("_", " ")}
                      </small>
                    </div>
                    <b>{money(Math.max(0, t - p), v.invoice!.currency)}</b>
                    <time>{v.invoice!.status.replaceAll("_", " ")}</time>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <strong>{query ? "No matching visit" : "No active visits awaiting billing closure"}</strong>
              <p>{query ? "Try a different patient name or reference." : "Settled visits disappear after they are completed."}</p>
            </div>
          )}
        </section>
      </>
    );
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Invoice settlement</p>
          <h1>{active.patient.fullName}</h1>
          <p>
            {active.patient.patientNumber} · {active.visitNumber}
          </p>
        </div>
        <button className="secondary" onClick={() => setActive(null)}>
          ← Back to invoices
        </button>
      </header>
      {error && <div className="alert">{error}</div>}
      <section className="card billingDocument">
        <FacilityLetterhead
          facilityName={active.facility?.name}
          title="Invoice"
          reference={invoice.invoiceNumber}
          badge={<strong>{invoice.status.replaceAll("_", " ")}</strong>}
        />
        <div className="cardHead">
          <div>
            <h2>Patient invoice</h2>
            <p>{active.patient.fullName} · {active.patient.patientNumber} · {active.visitNumber}</p>
          </div>
          <button className="secondary" onClick={() => window.print()}>
            Print invoice
          </button>
        </div>
        <table className="reportResults">
          <thead>
            <tr>
              <th>Code</th>
              <th>Service/item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((i) => (
              <tr key={i.id}>
                <td>{i.serviceCode}</td>
                <td>{i.description}</td>
                <td>{Number(i.quantity)}</td>
                <td>{money(Number(i.unitPrice), invoice.currency)}</td>
                <td>
                  {money(
                    Number(i.quantity) * Number(i.unitPrice),
                    invoice.currency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="billingTotals">
          <span>
            Total <strong>{money(total, invoice.currency)}</strong>
          </span>
          <span>
            Paid <strong>{money(paid, invoice.currency)}</strong>
          </span>
          <span>
            Insurance allocated <strong>{money(claimed, invoice.currency)}</strong>
          </span>
          <span>
            Patient pays <strong>{money(balance, invoice.currency)}</strong>
          </span>
        </div>
        {invoice.payments.length > 0 && (
          <div className="paymentHistory">
            <h3>Payments and receipts</h3>
            {invoice.payments.map((p) => (
              <div key={p.id}>
                <span>
                  {new Date(p.receivedAt).toLocaleString()} · {p.method}
                  {p.externalReference ? ` · ${p.externalReference}` : ""}
                </span>
                <strong>
                  {money(Number(p.amount), invoice.currency)} ·{" "}
                  {p.receipt?.receiptNumber} · {p.status}
                </strong>
                {p.status === "CONFIRMED" && (
                  <span className="reversalControl">
                    <input
                      aria-label={`Reversal reason ${p.receipt?.receiptNumber}`}
                      placeholder="Reason to reverse"
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={(e) =>
                        reverse(
                          p.id,
                          (
                            e.currentTarget
                              .previousElementSibling as HTMLInputElement
                          ).value,
                        )
                      }
                    >
                      Reverse
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {balance <= 0.001 && <section className="card noPrint visitClosure"><div><h2>Finish this visit</h2><p>Completion removes the patient from active queues. The system will stop and explain what remains if consultation, orders or financial cover are incomplete.</p></div><button className="primary" type="button" disabled={busy} onClick={() => void completeVisit()}>{busy ? "Checking…" : "Complete visit"}</button></section>}
      <form className="card dataForm noPrint" onSubmit={submit}>
        <div className="wide">
          <h2>Receive payment</h2>
          <p>Split payments are supported. The server prevents overpayment.</p>
        </div>
        <label>
          Method *
          <select name="method">
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank transfer</option>
          </select>
        </label>
        <label>
          Amount *
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            max={balance}
            defaultValue={balance.toFixed(2)}
            required
          />
        </label>
        <label className="wide">
          Transaction / approval reference
          <input
            name="externalReference"
            placeholder="Required for non-cash methods"
          />
        </label>
        <div className="wide submitBar">
          <span>
            A fully paid visit closes only after consultation is signed and all
            orders are resolved.
          </span>
          <button className="primary" disabled={busy}>
            {busy ? "Recording…" : "Record payment & issue receipt"}
          </button>
        </div>
      </form>
      <form className="card dataForm noPrint" onSubmit={claim}>
        <div className="wide">
          <h2>Submit payer claim</h2>
          <p>
            SHA, insurer and employer balances are tracked as claims—not cash
            receipts.
          </p>
        </div>
        <label>
          Payer *
          <select name="payer" value={claimPayer} onChange={event => setClaimPayer(event.target.value)}>
            <option value="SHA">SHA</option>
            <option value="PRIVATE_INSURER">Private insurer</option>
            <option value="EMPLOYER">Employer</option>
          </select>
        </label>
        <label>
          Member / policy number *<input name="memberNumber" required />
        </label>
        {claimPayer === "SHA" && <>
          <label>
            Intended SHA fund *
            <select name="shaFund" value={shaFund} onChange={event => setShaFund(event.target.value)} required>
              <option value="PHF">PHF · Primary Healthcare Fund</option>
              <option value="SHIF">SHIF · Social Health Insurance Fund</option>
              <option value="ECCIF">ECCIF · Emergency, Chronic & Critical Illness Fund</option>
              <option value="POMSF">POMSF · Public Officers Medical Scheme Fund</option>
            </select>
          </label>
          <label>
            Eligibility verification reference
            <input name="shaEligibilityReference" placeholder="Pending until SHA verification is available" />
          </label>
          <label>
            Referral / access-exception reference
            <input name="shaReferralReference" placeholder="Required before non-emergency SHIF submission" />
          </label>
          <label className="checks">
            <input name="shaEmergency" type="checkbox" checked={shaEmergency} onChange={event => setShaEmergency(event.target.checked)} />
            Emergency care
          </label>
          {shaEmergency && <label>
            Emergency notification reference
            <input name="shaEmergencyNotificationReference" placeholder="Record after notifying SHA" />
          </label>}
          <label className="checks">
            <input name="shaPreauthorisationRequired" type="checkbox" checked={shaPreauthorisationRequired} onChange={event => setShaPreauthorisationRequired(event.target.checked)} />
            Pre-authorisation required under the draft benefit rules
          </label>
          {shaPreauthorisationRequired && <label>
            Pre-authorisation reference
            <input name="shaPreauthorisationReference" placeholder="Pending until authorised by SHA" />
          </label>}
          {shaFund === "POMSF" && <>
            <label>
              POMSF employer ID
              <input name="shaPomsfEmployerId" placeholder="From SHA eligibility response" />
            </label>
            <label>
              Principal member public-service grade
              <input name="shaPublicServiceGrade" placeholder="Grade returned by SHA" />
            </label>
          </>}
        </>}
        <fieldset className="wide coverageItems"><legend>Services covered by this insurer *</legend><p>Untick anything the insurer does not cover. Unticked lines remain on the facility invoice and become payable by the patient.</p>{invoice.items.map(item => { const allocated = invoice.claims.some(c => ["DRAFT", "SUBMITTED", "APPROVED", "PAID"].includes(c.status) && c.lines?.some(line => line.invoiceItemId === item.id)); return <label key={item.id}><input type="checkbox" name="coveredItemIds" value={item.id} defaultChecked={!allocated} disabled={allocated}/><span><strong>{item.description}</strong><small>{money(Number(item.quantity) * Number(item.unitPrice), invoice.currency)}{allocated ? " · already allocated" : ""}</small></span></label>; })}</fieldset>
        <label>
          Claim note
          <input name="claimNotes" />
        </label>
        {claimPayer === "SHA" && <div className={`wide ${shaReady ? "privacyNotice" : "allergyAlert"}`}><strong>{shaReady ? "SHA gateway configured" : `SHA draft preparation · ${shaReadiness?.contract.draftVersion || "2026-09-09"}`}</strong><span>{shaReady ? "Submission will require verified identity, a signed encounter, ICD-11 coding and completed orders." : "Mwein has not signed the SHA contracts. This records preparation evidence only and cannot be represented as an eligible, authorised or submitted SHA claim."}</span></div>}
        <button className="primary wide" disabled={busy}>
          {claimPayer === "SHA" && !shaReady ? "Save SHA claim draft" : "Submit claim"}
        </button>
      </form>
      {invoice.claims?.length > 0 && (
        <section className="card noPrint">
          <h2>Claims</h2>
          <div className="queue compact">
            {invoice.claims.map((c) => {
              const preparation = c.shaPreparation;
              const deadline = preparation ? emergencyDeadline(preparation, clock) : null;
              const issues = preparation?.readinessIssues || [];
              return <form
                className="row claimRow"
                key={c.id}
                onSubmit={(event) => updateClaim(event, c.id)}
              >
                <span className="dot" />
                <div>
                  <strong>{c.claimNumber}</strong>
                  <small>
                    {c.payer} · Member {c.memberNumber} · {c.status}
                  </small>
                  <small>{c.lines?.length || 0} covered invoice item{c.lines?.length === 1 ? "" : "s"}</small>
                  {c.payer === "SHA" && preparation && <>
                    <small>{preparation.fund || "SHA fund pending"} · draft contract {preparation.contractVersion || "not recorded"} · {issues.length} readiness item{issues.length === 1 ? "" : "s"}</small>
                    {deadline && <small className={deadline.state === "OVERDUE" ? "dangerText" : ""}>{deadline.text}</small>}
                    <details className="managementPanel compact"><summary><span><strong>SHA readiness checklist</strong><small>{issues.length ? `${issues.length} item${issues.length === 1 ? "" : "s"} pending` : "Preparation evidence complete"}</small></span></summary><div className="managementBody queue">
                      <div className="summaryLine"><strong>Clinical claim foundation</strong><span>SHA number matched · encounter signed · ICD-11 coded · orders resolved</span></div>
                      <div className="summaryLine"><strong>Intended fund</strong><span>{preparation.fund || "Pending"}</span></div>
                      <div className="summaryLine"><strong>Eligibility reference</strong><span>{preparation.eligibilityReference || "Pending"}</span></div>
                      {preparation.fund === "SHIF" && <div className="summaryLine"><strong>Referral / exception</strong><span>{preparation.referralReference || "Pending"}</span></div>}
                      {preparation.preauthorisationRequired && <div className="summaryLine"><strong>Pre-authorisation</strong><span>{preparation.preauthorisationReference || "Pending"}</span></div>}
                      {preparation.fund === "POMSF" && <><div className="summaryLine"><strong>POMSF employer ID</strong><span>{preparation.pomsfEmployerId || "Pending"}</span></div><div className="summaryLine"><strong>Public-service grade</strong><span>{preparation.publicServiceGrade || "Pending"}</span></div></>}
                      {issues.map(issue => <div className="alert" key={issue.code}>{issue.message}</div>)}
                      {!issues.length && <div className="alert success">All preparation evidence currently required by the draft workflow is recorded. Live submission remains disabled.</div>}
                    </div></details>
                  </>}
                </div>
                <b>{money(Number(c.amount), invoice.currency)}</b>
                {allowedClaimStatuses(c.status as ClaimStatus).length > 0 && c.payer !== "SHA" && (
                  <div className="claimActions">
                    <select name="status" aria-label={`Status for ${c.claimNumber}`}>
                      {allowedClaimStatuses(c.status as ClaimStatus).map((status) => (
                        <option value={status} key={status}>
                          {status === "PAID"
                            ? "Mark paid"
                            : status.charAt(0) + status.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <input name="notes" placeholder="Required note" minLength={2} required />
                    <button className="secondary" disabled={busy}>Update</button>
                  </div>
                )}
              </form>;
            })}
          </div>
        </section>
      )}
    </>
  );
}
