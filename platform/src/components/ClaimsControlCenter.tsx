"use client";

import { useEffect, useState } from "react";
import { jsonRequest } from "@/lib/client-http";

type AlertClaim = {
  id: string;
  claimNumber: string;
  patientName: string;
  patientNumber: string;
  fundCode?: string | null;
  amount: number;
  status: string;
  deadline: string;
  daysRemaining: number;
  severity: "OVERDUE" | "URGENT" | "WATCH";
};

type ControlData = {
  summary: {
    total: number;
    open: number;
    draft: number;
    corrections: number;
    reviews: number;
    unpaid: number;
    alerts: AlertClaim[];
  };
};

const money = (amount: number) => `KES ${amount.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export default function ClaimsControlCenter({ refreshSignal }: { refreshSignal: string }) {
  const [data, setData] = useState<ControlData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void jsonRequest<ControlData>("/api/claims/control-center", undefined, "SHA claims overview could not be loaded")
      .then(result => { if (active) { setData(result); setError(""); } })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, [refreshSignal]);

  if (error) return <section className="card"><h2>SHA claims control centre</h2><p className="dangerText">{error}</p></section>;
  if (!data) return <section className="card"><h2>SHA claims control centre</h2><p>Loading claim deadlines…</p></section>;
  const { summary } = data;
  return <section className="card claimsControlCenter">
    <div className="cardHead"><div><h2>SHA claims control centre</h2><p>Submission, correction, review and payment exposure across the facility.</p></div><b>{summary.alerts.filter(item => item.severity !== "WATCH").length} urgent</b></div>
    <div className="claimMetrics">
      <article><span>Open claims</span><strong>{summary.open}</strong></article>
      <article><span>Drafts</span><strong>{summary.draft}</strong></article>
      <article><span>Corrections</span><strong>{summary.corrections}</strong></article>
      <article><span>Reviews</span><strong>{summary.reviews}</strong></article>
      <article><span>Unpaid exposure</span><strong>{money(summary.unpaid)}</strong></article>
    </div>
    {summary.alerts.length ? <div className="claimAlertList">{summary.alerts.slice(0, 12).map(claim => <article className={claim.severity.toLowerCase()} key={claim.id}>
      <div><strong>{claim.claimNumber} · {claim.patientName}</strong><span>{claim.patientNumber} · {claim.fundCode || "SHA"} · {claim.status.replaceAll("_", " ")}</span></div>
      <div><strong>{claim.daysRemaining < 0 ? `${Math.abs(claim.daysRemaining)} day(s) overdue` : claim.daysRemaining === 0 ? "Due today" : `${claim.daysRemaining} day(s) remaining`}</strong><span>{new Date(claim.deadline).toLocaleDateString("en-KE", { dateStyle: "medium" })} · {money(claim.amount)}</span></div>
    </article>)}</div> : <p className="listHint">No urgent SHA claim deadlines.</p>}
  </section>;
}
