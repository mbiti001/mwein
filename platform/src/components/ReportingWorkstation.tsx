"use client";

import { FormEvent, useEffect, useState } from "react";

type Report = {
  range: { from: string; to: string };
  generatedAt: string;
  summary: {
    visits: number;
    completedVisits: number;
    emergencyVisits: number;
    billed: number;
    received: number;
    outstanding: number;
    claimExceptions: {
      id: string;
      claimNumber: string;
      payer: string;
      amount: number;
      status: string;
      reason: string;
    }[];
  };
};

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const money = (value: number) => `KES ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReportingWorkstation() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(from: string, to: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/operations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Report could not be generated");
      setReport(data);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(today(), today()); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void load(String(form.get("from")), String(form.get("to")));
  }

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Operational intelligence</p>
          <h1>Facility reports</h1>
          <p>Review workload, collections and payer exceptions without exporting patient-level data.</p>
        </div>
        <button className="secondary noPrint" onClick={() => window.print()} disabled={!report}>Print report</button>
      </header>
      {error && <div className="alert">{error}</div>}
      <form className="card reportFilters noPrint" onSubmit={submit}>
        <label>From<input name="from" type="date" defaultValue={today()} required /></label>
        <label>To<input name="to" type="date" defaultValue={today()} required /></label>
        <button className="primary" disabled={busy}>{busy ? "Generating…" : "Generate report"}</button>
      </form>
      {report && (
        <>
          <section className="metrics reportMetrics">
            <article><small>Visits</small><strong>{report.summary.visits}</strong><span>{report.summary.completedVisits} completed</span></article>
            <article><small>Emergency visits</small><strong>{report.summary.emergencyVisits}</strong><span>Within selected arrival dates</span></article>
            <article><small>Gross billed</small><strong>{money(report.summary.billed)}</strong><span>Before reversals and adjustments</span></article>
            <article><small>Confirmed receipts</small><strong>{money(report.summary.received)}</strong><span>{money(report.summary.outstanding)} outstanding</span></article>
          </section>
          <section className="card">
            <div className="cardHead"><div><h2>Claim exceptions</h2><p>Rejected claims and submissions unchanged for more than seven days.</p></div><small>{report.range.from} — {report.range.to}</small></div>
            {report.summary.claimExceptions.length ? (
              <div className="queue compact">
                {report.summary.claimExceptions.map((claim) => (
                  <div className="row urgent" key={claim.id}>
                    <span className="dot" /><div><strong>{claim.claimNumber}</strong><small>{claim.payer} · {claim.reason}</small></div>
                    <b>{money(claim.amount)}</b><time>{claim.status}</time>
                  </div>
                ))}
              </div>
            ) : <div className="empty"><strong>No claim exceptions</strong><p>The selected period has no rejected or stale submitted claims.</p></div>}
          </section>
        </>
      )}
    </>
  );
}
