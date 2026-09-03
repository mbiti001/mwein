"use client";

import { FormEvent, useEffect, useState } from "react";
import { canonicalLaboratoryCode, laboratoryDisplayName, laboratoryFlagSummary, ZYBIO_Z3_PROFILE } from "@/lib/laboratory";

type ReferenceRange = {
  id: string;
  analyte: string;
  componentCode?: string | null;
  loincCode?: string | null;
  unit?: string | null;
  sexAtBirth: string;
  minAgeDays?: number | null;
  maxAgeDays?: number | null;
  lowerLimit?: string | null;
  upperLimit?: string | null;
  criticalLow?: string | null;
  criticalHigh?: string | null;
  qualitativeValues?: string | null;
  method?: string | null;
  source?: string | null;
};
type CatalogTest = { code: string; referenceRanges: ReferenceRange[] };

type LabOrder = {
  id: string;
  type: string;
  status: string;
  displayName: string;
  clinicalIndication?: string | null;
  laboratory?: {
    testCode: string;
    specimenType: string;
    accessionNumber?: string | null;
    collectedAt?: string | null;
    receivedAt?: string | null;
    specimenCondition?: string | null;
    specimenStatus?: string;
    rejectionReason?: string | null;
    result?: {
      status: string;
      reportText?: string | null;
      recordedAt?: string;
      verifiedAt?: string | null;
      criticalResult?: boolean;
      recordedBy?: { displayName: string };
      verifiedBy?: { displayName: string } | null;
      items: {
        analyte: string;
        value: string;
        unit?: string | null;
        referenceRange?: string | null;
        flag?: string | null;
        critical?: boolean;
      }[];
    } | null;
  } | null;
};
type Visit = {
  id: string;
  visitNumber: string;
  priority: string;
  facility?: { name: string; code: string };
  patient: {
    fullName: string;
    patientNumber: string;
    sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
    dateOfBirth?: string | null;
    estimatedAgeYears?: number | null;
  };
  orders?: LabOrder[];
};
function applicableRanges(
  configured: ReferenceRange[],
  patient: Visit["patient"],
) {
  const birth = patient.dateOfBirth ? new Date(patient.dateOfBirth) : null;
  const ageDays = birth
    ? Math.max(0, Math.floor((Date.now() - birth.getTime()) / 86400000))
    : patient.estimatedAgeYears != null
      ? patient.estimatedAgeYears * 365
      : null;
  const candidates = configured.filter(
    (range) =>
      (range.sexAtBirth === "ANY" || range.sexAtBirth === patient.sexAtBirth) &&
      (ageDays === null ||
        ((range.minAgeDays == null || ageDays >= range.minAgeDays) &&
          (range.maxAgeDays == null || ageDays <= range.maxAgeDays))),
  );
  return [
    ...new Map(
      candidates
        .sort(
          (a, b) =>
            (a.sexAtBirth === "ANY" ? 1 : 0) - (b.sexAtBirth === "ANY" ? 1 : 0),
        )
        .map((range) => [range.analyte, range]),
    ).values(),
  ];
}
function exportResultCsv(visit: Visit, order: LabOrder) {
  const result = order.laboratory?.result;
  if (!result) return;
  const quote = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["Facility", visit.facility?.name],
    ["Patient", visit.patient.fullName],
    ["Patient number", visit.patient.patientNumber],
    ["Visit", visit.visitNumber],
    ["Test", laboratoryDisplayName(order.laboratory?.testCode || "", order.displayName)],
    ["Accession", order.laboratory?.accessionNumber],
    ["Collected", order.laboratory?.collectedAt],
    ["Received", order.laboratory?.receivedAt],
    [],
    ["Analyte", "Result", "Unit", "Reference interval", "Flag"],
    ...result.items.map((item) => [
      item.analyte,
      item.value,
      item.unit,
      item.referenceRange,
      item.flag,
    ]),
    [],
    ["Comment", result.reportText],
    ["Verified by", result.verifiedBy?.displayName],
    ["Released", result.verifiedAt],
  ]
    .map((row) => row.map(quote).join(","))
    .join("\n");
  const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${visit.patient.patientNumber}-${order.laboratory?.accessionNumber || "lab-result"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function LaboratoryWorkstation({
  visits,
  onUpdated,
}: {
  visits: Visit[];
  onUpdated: () => Promise<void>;
}) {
  const orders = visits.flatMap((visit) =>
    (visit.orders || [])
      .filter(
        (order) => order.type === "LABORATORY" && order.status !== "CANCELLED",
      )
      .map((order) => ({ visit, order })),
  );
  const [active, setActive] = useState<(typeof orders)[number] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tests, setTests] = useState<CatalogTest[]>([]);
  useEffect(() => {
    fetch("/api/catalog?category=LABORATORY_TEST")
      .then((response) => response.json())
      .then((data) => setTests(data.items || []))
      .catch(() => setError("Reference intervals could not be loaded"));
  }, []);
  async function specimen(
    action: "COLLECT" | "RECEIVE" | "REJECT",
    payload: Record<string, unknown>,
  ) {
    if (!active) return;
    setError("");
    const response = await fetch(`/api/orders/${active.order.id}/specimen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      return setError(result.error || "Specimen status could not be updated");
    setNotice(
      action === "COLLECT"
        ? "Specimen collected and accession assigned."
        : action === "RECEIVE"
          ? "Specimen accepted into the laboratory worklist."
          : "Specimen rejected; recollection is required.",
    );
    await onUpdated();
    setActive(null);
  }
  async function submit(
    form: HTMLFormElement,
    action: "SAVE_DRAFT" | "VERIFY",
  ) {
    if (!active) return;
    setError("");
    setNotice("");
    const data = new FormData(form);
    const ranges = applicableRanges(
      tests.find((test) => test.code === active.order.laboratory?.testCode)
        ?.referenceRanges || [],
      active.visit.patient,
    );
    const items = ranges.length
      ? ranges.map((range) => ({
          analyte: range.analyte,
          value: data.get(`value_${range.id}`),
        }))
      : [
          {
            analyte: String(data.get("analyte") || active.order.displayName),
            value: data.get("value"),
            unit: data.get("unit") || undefined,
            referenceRange: data.get("referenceRange") || undefined,
            flag: data.get("flag") || undefined,
          },
        ];
    const response = await fetch(
      `/api/orders/${active.order.id}/laboratory-result`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reportText: data.get("reportText") || undefined,
          criticalNotification: data.get("criticalNotifiedTo")
            ? {
                notifiedTo: data.get("criticalNotifiedTo"),
                method: data.get("criticalNotificationMethod"),
                notifiedAt: data.get("criticalNotifiedAt"),
                readBack: Boolean(data.get("criticalReadBack")),
                confirmation: data.get("criticalConfirmation"),
                escalation: data.get("criticalEscalation") || undefined,
              }
            : undefined,
          items,
        }),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      return setError(result.error || "The result could not be saved");
    setNotice(
      action === "VERIFY"
        ? "Result verified and released to the clinician."
        : "Result saved as a draft.",
    );
    await onUpdated();
    if (action === "VERIFY") setActive(null);
  }
  if (!active)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Diagnostics</p>
            <h1>Laboratory orders</h1>
            <p>
              Document results against the submitted request, then verify before
              release.
            </p>
          </div>
        </header>
        <section className="card">
          {orders.length === 0 ? (
            <div className="empty">
              <strong>No laboratory requests</strong>
              <p>Submitted consultation orders appear here automatically.</p>
            </div>
          ) : (
            <div className="queue">
              {orders.map(({ visit, order }) => (
                <button
                  className={`row ${visit.priority.toLowerCase()}`}
                  key={order.id}
                  onClick={() => setActive({ visit, order })}
                >
                  <span className="dot" />
                  <div>
                    <strong>{visit.patient.fullName}</strong>
                    <small>
                      {visit.patient.patientNumber} · {laboratoryDisplayName(order.laboratory?.testCode || "", order.displayName)} ·{" "}
                      {order.laboratory?.specimenType}
                    </small>
                  </div>
                  <b>
                    {(
                      order.laboratory?.specimenStatus || order.status
                    ).replaceAll("_", " ")}
                  </b>
                  <time>{visit.visitNumber}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      </>
    );
  const existing = active.order.laboratory?.result;
  const configuredRanges =
    tests.find((test) => test.code === active.order.laboratory?.testCode)
      ?.referenceRanges || [];
  const ranges = applicableRanges(configuredRanges, active.visit.patient);
  const specimenStatus =
    active.order.laboratory?.specimenStatus || "NOT_COLLECTED";
  if (specimenStatus !== "ACCEPTED")
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Specimen workflow</p>
            <h1>{laboratoryDisplayName(active.order.laboratory?.testCode || "", active.order.displayName)}</h1>
            <p>
              {active.visit.patient.fullName} ·{" "}
              {active.visit.patient.patientNumber} · {active.visit.visitNumber}
            </p>
          </div>
          <button className="secondary" onClick={() => setActive(null)}>
            ← Back to worklist
          </button>
        </header>
        <form
          className="card dataForm"
          onSubmit={(event) => event.preventDefault()}
        >
          {error && <div className="alert wide">{error}</div>}
          {notice && <div className="alert success wide">{notice}</div>}
          <div className="patientBanner wide">
            <div>
              <strong>{active.order.laboratory?.specimenType} specimen</strong>
              <span>
                {active.order.laboratory?.accessionNumber ||
                  "Accession pending"}
              </span>
            </div>
            <b>{specimenStatus.replaceAll("_", " ")}</b>
          </div>
          {["NOT_COLLECTED", "REJECTED"].includes(specimenStatus) ? (
            <>
              <label>
                Collection date and time *
                <input name="collectionTime" type="datetime-local" required />
              </label>
              {active.order.laboratory?.rejectionReason && (
                <div className="alert">
                  <strong>Previous specimen rejected</strong>
                  <br />
                  {active.order.laboratory.rejectionReason}
                </div>
              )}
              <div className="wide submitBar">
                <span>
                  Confirm patient identity, request, specimen type, container
                  and label before collection.
                </span>
                <button
                  className="primary"
                  onClick={(event) =>
                    specimen("COLLECT", {
                      collectedAt: new FormData(event.currentTarget.form!).get(
                        "collectionTime",
                      ),
                    })
                  }
                >
                  Record collection & assign accession
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="privacyNotice wide">
                <strong>
                  Accession {active.order.laboratory?.accessionNumber}
                </strong>
                <span>
                  Collected{" "}
                  {active.order.laboratory?.collectedAt
                    ? new Date(
                        active.order.laboratory.collectedAt,
                      ).toLocaleString()
                    : "—"}
                  . Inspect identity, volume, container and integrity.
                </span>
              </div>
              <label>
                Receipt date and time *
                <input name="receiptTime" type="datetime-local" required />
              </label>
              <label>
                Specimen condition
                <select name="condition">
                  <option value="ACCEPTABLE">Acceptable</option>
                  <option value="HAEMOLYSED">Haemolysed but usable</option>
                  <option value="LIPEMIC">Lipaemic but usable</option>
                  <option value="ICTERIC">Icteric but usable</option>
                  <option value="OTHER">Other documented condition</option>
                </select>
              </label>
              <label className="wide">
                Rejection reason
                <textarea
                  name="rejectionReason"
                  rows={3}
                  placeholder="Required when rejecting: unlabelled, wrong patient, insufficient, clotted, leaking, delayed transport…"
                />
              </label>
              <div className="wide submitBar">
                <button
                  className="secondary"
                  onClick={(event) =>
                    specimen("REJECT", {
                      reason: new FormData(event.currentTarget.form!).get(
                        "rejectionReason",
                      ),
                    })
                  }
                >
                  Reject and request recollection
                </button>
                <button
                  className="primary"
                  onClick={(event) => {
                    const data = new FormData(event.currentTarget.form!);
                    specimen("RECEIVE", {
                      receivedAt: data.get("receiptTime"),
                      specimenCondition: data.get("condition"),
                    });
                  }}
                >
                  Accept into worklist
                </button>
              </div>
            </>
          )}
        </form>
      </>
    );
  if (existing?.status === "VERIFIED")
    return (
      <VerifiedReport
        visit={active.visit}
        order={active.order}
        onBack={() => setActive(null)}
      />
    );
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Laboratory result</p>
          <h1>{laboratoryDisplayName(active.order.laboratory?.testCode || "", active.order.displayName)}</h1>
          <p>
            {active.visit.patient.fullName} ·{" "}
            {active.visit.patient.patientNumber} · {active.visit.visitNumber}
          </p>
        </div>
        <button className="secondary" onClick={() => setActive(null)}>
          ← Back to orders
        </button>
      </header>
      <form
        className="card dataForm"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submit(event.currentTarget, "SAVE_DRAFT");
        }}
      >
        {error && <div className="alert wide">{error}</div>}
        {notice && <div className="alert success wide">{notice}</div>}
        <div className="patientBanner wide">
          <div>
            <strong>{laboratoryDisplayName(active.order.laboratory?.testCode || "", active.order.displayName)}</strong>
            <span>
              Specimen: {active.order.laboratory?.specimenType} · Indication:{" "}
              {active.order.clinicalIndication || "Not stated"}
            </span>
          </div>
          <b>{active.order.status}</b>
        </div>
        {ranges.length ? (
          <div className="wide resultGrid">
            <div className="resultGridHead">
              <b>Analyte</b>
              <b>Result</b>
              <b>Unit</b>
              <b>Reference / decision interval</b>
              <b>Critical limits</b>
            </div>
            {ranges.map((range) => {
              const saved = existing?.items.find(
                (item) => item.analyte === range.analyte,
              );
              const interval =
                range.qualitativeValues ||
                `${range.lowerLimit ?? "—"} – ${range.upperLimit ?? "—"}`;
              return (
                <div className="resultGridRow" key={range.id}>
                  <span>
                    <strong>{range.analyte}</strong>
                    <small>
                      {range.componentCode || "Local component"}
                      {range.loincCode ? ` · LOINC ${range.loincCode}` : ""}
                      {" · "}
                      {range.sexAtBirth !== "ANY"
                        ? range.sexAtBirth
                        : "All patients"}
                      {range.method ? ` · ${range.method}` : ""}
                    </small>
                  </span>
                  {range.qualitativeValues ? (
                    <select name={`value_${range.id}`} required defaultValue={saved?.value || ""}>
                      <option value="" disabled>Select result</option>
                      {range.qualitativeValues.split("|").map(value => <option key={value}>{value}</option>)}
                    </select>
                  ) : (
                    <input name={`value_${range.id}`} type="number" step="any" required defaultValue={saved?.value} />
                  )}
                  <span>{range.unit || "—"}</span>
                  <span>{interval}</span>
                  <span>
                    {range.criticalLow || range.criticalHigh
                      ? `${range.criticalLow ?? "—"} / ${range.criticalHigh ?? "—"}`
                      : "Not defined"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="privacyNotice wide">
              <strong>No approved interval configured</strong>
              <span>
                Enter the result manually, but configure and verify a facility
                reference interval before routine reporting.
              </span>
            </div>
            <label>
              Analyte / observation *
              <input
                name="analyte"
                required
                defaultValue={
                  existing?.items[0]?.analyte || active.order.displayName
                }
              />
            </label>
            <label>
              Result *
              <input
                name="value"
                required
                defaultValue={existing?.items[0]?.value}
              />
            </label>
            <label>
              Unit
              <input
                name="unit"
                defaultValue={existing?.items[0]?.unit || ""}
              />
            </label>
            <label>
              Reference interval
              <input
                name="referenceRange"
                defaultValue={existing?.items[0]?.referenceRange || ""}
              />
            </label>
            <label>
              Result flag
              <select
                name="flag"
                defaultValue={existing?.items[0]?.flag || "N"}
              >
                <option value="N">N — within range</option>
                <option value="L">L — low</option>
                <option value="H">H — high</option>
                <option value="LL">LL — critical low</option>
                <option value="HH">HH — critical high</option>
                <option value="A">A — analyser/abnormal flag</option>
                <option value="P">P — preliminary</option>
                <option value="R">R — repeated/confirmed</option>
              </select>
            </label>
          </>
        )}
        <label className="wide">
          Laboratory comment
          <textarea
            name="reportText"
            rows={4}
            defaultValue={existing?.reportText || ""}
          />
        </label>
        <div className="wide confidential">
          <strong>Critical-result communication</strong>
          <p>
            Complete this before verifying any result at or beyond a configured
            critical limit.
          </p>
          <div className="sectionGrid">
            <label>
              Clinician notified
              <input name="criticalNotifiedTo" placeholder="Name and role" />
            </label>
            <label>
              Notification method
              <select name="criticalNotificationMethod">
                <option value="PHONE">Telephone</option>
                <option value="IN_PERSON">In person</option>
                <option value="SECURE_MESSAGE">Secure message</option>
              </select>
            </label>
            <label>
              Notified at
              <input name="criticalNotifiedAt" type="datetime-local" />
            </label>
            <label>
              Result confirmation
              <input name="criticalConfirmation" placeholder="Repeated/confirmed, or reason not repeated" />
            </label>
            <label>
              Escalation (if unreachable)
              <input name="criticalEscalation" placeholder="Person contacted and action" />
            </label>
            <label className="checkLabel">
              <input name="criticalReadBack" type="checkbox" />
              Recipient read back the result
            </label>
          </div>
        </div>
        <div className="wide submitBar">
          <span>
            Drafts remain inside the laboratory. Verification releases the
            result to consultation and locks this version.
          </span>
          <div>
            <button className="secondary">Save draft</button>{" "}
            <button
              type="button"
              className="primary"
              onClick={(event) => submit(event.currentTarget.form!, "VERIFY")}
            >
              Verify and release result
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function VerifiedReport({
  visit,
  order,
  onBack,
}: {
  visit: Visit;
  order: LabOrder;
  onBack: () => void;
}) {
  const result = order.laboratory!.result!;
  return (
    <section className="labReport">
      <header className="labReportActions">
        <div>
          <p className="eyebrow">Verified laboratory report</p>
          <h1>{laboratoryDisplayName(order.laboratory?.testCode || "", order.displayName)}</h1>
        </div>
        <div>
          <button className="secondary" onClick={onBack}>
            ← Worklist
          </button>{" "}
          <button
            className="secondary"
            onClick={() => exportResultCsv(visit, order)}
          >
            Export CSV
          </button>{" "}
          <button className="primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>
      <article className="card reportPaper">
        <div className="reportTitle">
          <div>
            <h2>{visit.facility?.name || "Mwein Medical Services"}</h2>
            <span>Medical Laboratory Report</span>
          </div>
          <strong>
            {result.criticalResult ? "CRITICAL RESULT" : "FINAL REPORT"}
          </strong>
        </div>
        <section className="reportMeta">
          <div>
            <small>Patient</small>
            <b>{visit.patient.fullName}</b>
          </div>
          <div>
            <small>Patient number</small>
            <b>{visit.patient.patientNumber}</b>
          </div>
          <div>
            <small>Sex</small>
            <b>{visit.patient.sexAtBirth}</b>
          </div>
          <div>
            <small>Visit</small>
            <b>{visit.visitNumber}</b>
          </div>
          <div>
            <small>Accession</small>
            <b>{order.laboratory?.accessionNumber}</b>
          </div>
          <div>
            <small>Specimen</small>
            <b>
              {order.laboratory?.specimenType} ·{" "}
              {order.laboratory?.specimenCondition}
            </b>
          </div>
          <div>
            <small>Collected</small>
            <b>
              {order.laboratory?.collectedAt
                ? new Date(order.laboratory.collectedAt).toLocaleString()
                : "—"}
            </b>
          </div>
          <div>
            <small>Received</small>
            <b>
              {order.laboratory?.receivedAt
                ? new Date(order.laboratory.receivedAt).toLocaleString()
                : "—"}
            </b>
          </div>
        </section>
        <table className="reportResults">
          <thead>
            <tr>
              <th>Analyte</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Applicable reference interval</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr
                className={
                  item.critical
                    ? "critical"
                    : item.flag && item.flag !== "NORMAL"
                      ? "abnormal"
                      : ""
                }
                key={item.analyte}
              >
                <td>{item.analyte}</td>
                <td>
                  <strong>{item.value}</strong>
                </td>
                <td>{item.unit || "—"}</td>
                <td>{item.referenceRange || "Not established"}</td>
                <td>{item.flag || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="reportComment">
          <strong>Automated reference-interval flag summary</strong>
          <p>{laboratoryFlagSummary(result.items)}</p>
        </div>
        {result.reportText && (
          <div className="reportComment">
            <strong>Laboratory comment / interpretation</strong>
            <p>{result.reportText}</p>
          </div>
        )}
        <footer>
          <div>
            <small>Recorded by</small>
            <strong>
              {result.recordedBy?.displayName || "Laboratory staff"}
            </strong>
          </div>
          <div>
            <small>Authorised by</small>
            <strong>
              {result.verifiedBy?.displayName || "Laboratory staff"}
            </strong>
          </div>
          <div>
            <small>Released</small>
            <strong>
              {result.verifiedAt
                ? new Date(result.verifiedAt).toLocaleString()
                : "—"}
            </strong>
          </div>
        </footer>
        <div className="reportMethod">
          <strong>Method</strong>
          <span>
          {canonicalLaboratoryCode(order.laboratory?.testCode || "") === "FBC"
            ? ZYBIO_Z3_PROFILE.footer
            : "Reference intervals are population-, method- and analyser-dependent. Interpret results with the clinical context."}
          </span>
          <small>This electronically authorised report is valid without a handwritten signature.</small>
        </div>
      </article>
    </section>
  );
}
