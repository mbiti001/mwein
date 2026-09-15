"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  allowedClaimStatuses,
  type ClaimStatus,
} from "@/lib/billing";
import { jsonRequest } from "@/lib/client-http";
import CashierShiftPanel from "@/components/CashierShiftPanel";
import ClaimsControlCenter from "@/components/ClaimsControlCenter";
import { assessShaRoute, shaFundLabels, type ShaFund } from "@/lib/sha";
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
      createdAt: string;
      lines?: { invoiceItemId: string; amount: string }[];
    }[];
  } | null;
};
const money = (value: number, currency = "KES") =>
  `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [shaFund, setShaFund] = useState<ShaFund>("PHCF");
  const [eligibilityVerified, setEligibilityVerified] = useState(false);
  const [facilityServiceApproved, setFacilityServiceApproved] = useState(false);
  const [authorizationRequired, setAuthorizationRequired] = useState(false);
  const [authorizationReference, setAuthorizationReference] = useState("");
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const visibleQueue = useMemo(() => {
    const term = query.trim().toLowerCase();
    return queue.filter(v => !term || `${v.patient.fullName} ${v.patient.patientNumber} ${v.visitNumber} ${v.invoice?.invoiceNumber || ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [queue, query]);
  const [shaReady, setShaReady] = useState(false);
  useEffect(() => { void jsonRequest<{ ready: boolean }>("/api/integrations/sha/readiness", undefined, "SHA readiness could not be checked").then(result => setShaReady(result.ready)).catch(() => setShaReady(false)); }, []);
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
  const claimed = invoice?.claims.filter(c => ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD", "PAID"].includes(c.status)).reduce((sum, c) => sum + Number(c.amount), 0) || 0;
  const balance = Math.max(0, total - paid - claimed);
  const shaRoute = useMemo(() => assessShaRoute({
    fund: shaFund,
    eligibilityVerified,
    facilityServiceApproved,
    requiresAuthorization: authorizationRequired,
    authorizationReference,
    serviceDate: new Date(`${serviceDate}T00:00:00Z`),
  }), [shaFund, eligibilityVerified, facilityServiceApproved, authorizationRequired, authorizationReference, serviceDate]);
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
            coverageConsentReference: form.get("coverageConsentReference") || undefined,
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
    try {
      const d = await jsonRequest<any>(`/api/invoices/${invoice.id}/claims`, {
          method: "POST",
          body: JSON.stringify({
            payer: f.get("payer"),
            memberNumber: f.get("memberNumber"),
            coveredItemIds: f.getAll("coveredItemIds"),
            notes: f.get("claimNotes") || undefined,
            submit: f.get("payer") === "SHA" ? shaReady : true,
            fundCode: f.get("payer") === "SHA" ? shaFund : undefined,
            eligibilityVerified: f.get("payer") === "SHA" ? eligibilityVerified : undefined,
            facilityServiceApproved: f.get("payer") === "SHA" ? facilityServiceApproved : undefined,
            authorizationRequired: f.get("payer") === "SHA" ? authorizationRequired : undefined,
            authorizationReference: f.get("payer") === "SHA" ? authorizationReference || undefined : undefined,
            serviceDate: f.get("payer") === "SHA" ? serviceDate : undefined,
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
          <header>
            <div>
              <p className="eyebrow">
                {v.facility?.name || "Mwein Medical Services"}
              </p>
              <h1>Official receipt</h1>
              <p>{p.receipt.receiptNumber}</p>
            </div>
            <strong className="signedStatus">PAID</strong>
          </header>
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
        {permissions.includes("claims.write") && <ClaimsControlCenter refreshSignal={lastReceipt} />}
        {permissions.includes("billing.write") && <CashierShiftPanel permissions={permissions} />}
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
        <div className="cardHead">
          <div>
            <h2>{invoice.invoiceNumber}</h2>
            <p>
              {active.facility?.name || "Mwein Medical Services"} ·{" "}
              {invoice.status.replaceAll("_", " ")}
            </p>
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
        <label className="wide">
          SHA itemised quotation / written top-up consent reference
          <input name="coverageConsentReference" placeholder="Required before collecting a permitted SHIF top-up" />
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
        {claimPayer === "SHA" && <fieldset className="wide shaBenefitEngine">
          <legend>SHA Benefit Engine</legend>
          <div className="shaRouteGrid">
            <label>Paying Fund *<select value={shaFund} onChange={event => setShaFund(event.target.value as ShaFund)}>{Object.entries(shaFundLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label>Date of service *<input type="date" value={serviceDate} onChange={event => setServiceDate(event.target.value)} required /></label>
          </div>
          <div className="shaChecks">
            <label><input type="checkbox" checked={eligibilityVerified} onChange={event => setEligibilityVerified(event.target.checked)} /> Eligibility verified on SHA platform</label>
            <label><input type="checkbox" checked={facilityServiceApproved} onChange={event => setFacilityServiceApproved(event.target.checked)} /> Service line active for Mwein</label>
            <label><input type="checkbox" checked={authorizationRequired} onChange={event => setAuthorizationRequired(event.target.checked)} /> Pre-authorisation required</label>
          </div>
          {authorizationRequired && <label>Pre-authorisation reference *<input value={authorizationReference} onChange={event => setAuthorizationReference(event.target.value)} required /></label>}
          <div className={`shaDecision ${shaRoute.ready ? "ready" : "blocked"}`}>
            <strong>{shaRoute.ready ? "Routing checks complete" : `${shaRoute.blockers.length} submission blocker${shaRoute.blockers.length === 1 ? "" : "s"}`}</strong>
            <span>Submit by {shaRoute.deadline.toLocaleDateString("en-KE", { dateStyle: "medium", timeZone: "UTC" })}</span>
            {shaRoute.blockers.map(item => <small key={item}>• {item}</small>)}
            {shaRoute.warnings.map(item => <small key={item}>• {item}</small>)}
          </div>
        </fieldset>}
        <fieldset className="wide coverageItems"><legend>Services covered by this insurer *</legend><p>Untick anything the insurer does not cover. For SHA, any patient-pay remainder still requires the applicable Fund rules and documented consent.</p>{invoice.items.map(item => { const allocated = invoice.claims.some(c => ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "REDUCED", "UNDER_REVIEW", "WITHHELD", "PAID"].includes(c.status) && c.lines?.some(line => line.invoiceItemId === item.id)); return <label key={item.id}><input type="checkbox" name="coveredItemIds" value={item.id} defaultChecked={!allocated} disabled={allocated}/><span><strong>{item.description}</strong><small>{money(Number(item.quantity) * Number(item.unitPrice), invoice.currency)}{allocated ? " · already allocated" : ""}</small></span></label>; })}</fieldset>
        <label>
          Claim note
          <input name="claimNotes" />
        </label>
        {claimPayer === "SHA" && <div className={`wide ${shaReady ? "privacyNotice" : "allergyAlert"}`}><strong>{shaReady ? "SHA gateway configured" : "SHA gateway not yet connected"}</strong><span>{shaReady ? "Submission also requires a verified identity, signed encounter, ICD-11 coding and completed orders." : "This will save a local draft only. It will not be represented as submitted to SHA."}</span></div>}
        <button className="primary wide" disabled={busy}>
          {claimPayer === "SHA" && !shaReady ? "Save SHA claim draft" : "Submit claim"}
        </button>
      </form>
      {invoice.claims?.length > 0 && (
        <section className="card noPrint">
          <h2>Claims</h2>
          <div className="queue compact">
            {invoice.claims.map((c) => (
              <form
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
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
