"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  allowedClaimStatuses,
  type ClaimStatus,
} from "@/lib/billing";
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
    }[];
  } | null;
};
const money = (value: number, currency = "KES") =>
  `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function BillingWorkstation({
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
    () => visits.filter((v) => v.invoice && v.invoice.status !== "PAID"),
    [visits],
  );
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState("");
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
  const balance = Math.max(0, total - paid);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: form.get("method"),
          amount: form.get("amount"),
          externalReference: form.get("externalReference") || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Payment could not be recorded");
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
      const r = await fetch(`/api/invoices/${invoice.id}/claims`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payer: f.get("payer"),
            memberNumber: f.get("memberNumber"),
            amount: f.get("claimAmount"),
            notes: f.get("claimNotes") || undefined,
            submit: true,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || "Claim could not be created");
      setLastReceipt(`Claim ${d.claim.claimNumber} submitted`);
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
      const r = await fetch(`/api/payments/${paymentId}/reverse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || "Payment could not be reversed");
      await onUpdated();
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
      const response = await fetch(`/api/claims/${claimId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.get("status"),
          notes: form.get("notes"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Claim status could not be updated");
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
        <section className="card">
          {queue.length ? (
            <div className="queue">
              {queue.map((v) => {
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
              <strong>No unpaid active-visit invoices</strong>
              <p>New visit charges appear here automatically.</p>
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
            Balance <strong>{money(balance, invoice.currency)}</strong>
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
          <select name="payer">
            <option value="SHA">SHA</option>
            <option value="PRIVATE_INSURER">Private insurer</option>
            <option value="EMPLOYER">Employer</option>
          </select>
        </label>
        <label>
          Member / policy number *<input name="memberNumber" required />
        </label>
        <label>
          Claim amount *
          <input
            name="claimAmount"
            type="number"
            min="0.01"
            max={balance}
            step="0.01"
            defaultValue={balance.toFixed(2)}
            required
          />
        </label>
        <label>
          Claim note
          <input name="claimNotes" />
        </label>
        <button className="primary wide" disabled={busy}>
          Submit claim
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
                </div>
                <b>{money(Number(c.amount), invoice.currency)}</b>
                {allowedClaimStatuses(c.status as ClaimStatus).length > 0 && (
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
