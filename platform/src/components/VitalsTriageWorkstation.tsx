"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Visit } from "./ClinicalApp";
import { assessTriageVitals, patientClinicalGroup } from "@/lib/domain";
import { dateInTimeZone, gestationalAgeLabel, pregnancyDatingFromLnmp } from "@/lib/pregnancy-dating";
import { ApiRequestError, jsonRequest as api } from "@/lib/client-http";
import { isOpenClinicalVisit } from "@/lib/visit-check-in";
import VisitVitalsPanel from "./VisitVitalsPanel";
import VitalsWorkstation from "./VitalsWorkstation";
import { measuredVitalFields, type MeasuredValues } from "@/lib/measured-vitals";
import { useVitalsDraftGuard } from "./useVitalsDraftGuard";
import { confirmWorkspaceNavigation } from "./useUnsavedConsultation";
type Props = { visits: Visit[]; canAssess: boolean; canCapture: boolean; onCompleted: (patientName: string, visitId: string, status: string) => void | Promise<void>; initialVisitId?: string | null; onInitialVisitOpened?: () => void; facilityTimeZone: string };

export default function VitalsTriageWorkstation(props: Props) {
  if (!props.canAssess) return <VitalsWorkstation visits={props.visits} initialVisitId={props.initialVisitId} onInitialVisitOpened={props.onInitialVisitOpened || (() => {})} />;
  return <ClinicalTriage {...props} />;
}
function ClinicalTriage({ visits, canCapture, onCompleted, initialVisitId, onInitialVisitOpened, facilityTimeZone }: Props) {
  type TriageDraft = {
    temperatureC: string;
    pulseBpm: string;
    respiratoryRate: string;
    systolicBp: string;
    diastolicBp: string;
    oxygenSaturation: string;
    painScore: string;
    consciousness: "" | "ALERT" | "VOICE" | "PAIN" | "UNRESPONSIVE";
  };
  const blankVitals = (): TriageDraft => ({
    temperatureC: "",
    pulseBpm: "",
    respiratoryRate: "",
    systolicBp: "",
    diastolicBp: "",
    oxygenSaturation: "",
    painScore: "",
    consciousness: "",
  });
  const [active, setActive] = useState<Visit | null>(null);
  const [error, setError] = useState("");
  const [vitals, setVitals] = useState<TriageDraft>(blankVitals);
  const [lnmp, setLnmp] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [reviewedVitalsId, setReviewedVitalsId] = useState<string | undefined>();
  const [sourceValues, setSourceValues] = useState<MeasuredValues>({});
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false);
  const [measuredAt, setMeasuredAt] = useState(() => new Date(Date.now() + 3 * 3600000).toISOString().slice(0,16));
  const draft = useVitalsDraftGuard();
  const attempt = useRef<string | null>(null), mounted = useRef(true);
  const measurementTouched = useRef(false), activeId = useRef(active?.id); activeId.current = active?.id;
  const completedCallback = useRef(onCompleted); completedCallback.current = onCompleted;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function openVisit(visit: Visit) {
    if (!confirmWorkspaceNavigation()) return;
    setVitals(blankVitals()); setLnmp(""); setWeight(""); setHeight(""); setReviewedVitalsId(undefined); setSourceValues({});
    setError(""); setRetry(false); attempt.current = null; draft.dirty.current = false; measurementTouched.current = false;
    setMeasuredAt(new Date(Date.now() + 3 * 3600000).toISOString().slice(0,16)); setActive(visit);
  }
  function leaveVisit() {
    if (!confirmWorkspaceNavigation()) return;
    draft.dirty.current = false; attempt.current = null; setRetry(false); setError(""); setActive(null);
  }
  const currentVisit = visits.find(visit => visit.id === active?.id);
  const retainingAssessment = active?.status === "AWAITING_TRIAGE" && (draft.dirty.current || busy || retry);
  const canTriage = retainingAssessment || (currentVisit?.status === "AWAITING_TRIAGE" && !currentVisit.triage);
  const locked = (key: keyof MeasuredValues) => reviewedVitalsId !== undefined && sourceValues[key] !== undefined;
  const needsMeasurements = !reviewedVitalsId || measuredVitalFields.some(field => sourceValues[field.key] === undefined);
  function useMeasurements(values: MeasuredValues, id: string, automatic = false) {
    if (busy || retry) return;
    if (automatic && measurementTouched.current) return;
    if (reviewedVitalsId === id) return;
    if ((weight || height || Object.entries(vitals).some(([key,value]) => !["painScore","consciousness"].includes(key) && value)) && !window.confirm("Replace the measurements in this draft with the selected recorded set? Clinical assessment entries will be kept.")) return;
    setVitals(current => ({ ...current, ...Object.fromEntries(measuredVitalFields.filter(field => !["weightKg","heightCm"].includes(field.key)).map(field => [field.key, values[field.key]?.toString() ?? ""])) }));
    setWeight(values.weightKg?.toString() ?? ""); setHeight(values.heightCm?.toString() ?? ""); setReviewedVitalsId(id); setSourceValues(values); measurementTouched.current = true; if (!automatic) draft.dirty.current = true;
  }
  const facilityToday = dateInTimeZone(new Date(), facilityTimeZone);
  const pregnancyDating = useMemo(
    () => lnmp ? pregnancyDatingFromLnmp(lnmp, facilityToday) : null,
    [facilityToday, lnmp],
  );
  const assessedVitals = useMemo(() => {
    if (!vitals.consciousness || Object.entries(vitals).some(([key, value]) => key !== "consciousness" && value === "")) return null;
    return {
      temperatureC: Number(vitals.temperatureC),
      pulseBpm: Number(vitals.pulseBpm),
      respiratoryRate: Number(vitals.respiratoryRate),
      systolicBp: Number(vitals.systolicBp),
      diastolicBp: Number(vitals.diastolicBp),
      oxygenSaturation: Number(vitals.oxygenSaturation),
      painScore: Number(vitals.painScore),
      consciousness: vitals.consciousness,
    };
  }, [vitals]);
  const alerts = useMemo(() => assessedVitals ? assessTriageVitals(assessedVitals) : [], [assessedVitals]);
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = visits.find(item => item.id === initialVisitId);
    if (visit && visit.id !== active?.id) { openVisit(visit); onInitialVisitOpened?.(); }
  }, [initialVisitId, visits, onInitialVisitOpened]);
  function vital(name: keyof TriageDraft, value: string) {
    if (name !== "painScore" && name !== "consciousness") measurementTouched.current = true;
    setVitals((current) => ({
      ...current,
      [name]: value,
    }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || draft.pending.current) return;
    const savingVisitId = active.id;
    const f = new FormData(event.currentTarget);
    const body = attempt.current || JSON.stringify({
      ...vitals, reviewedVitalsId, requestKey: crypto.randomUUID(),
      measuredAt: new Date(measuredAt + ":00+03:00").toISOString(),
      chiefComplaint: f.get("chiefComplaint"), weightKg: weight, heightCm: height || undefined,
      triageCategory: f.get("triageCategory"), pregnancyStatus: f.get("pregnancyStatus") || undefined,
      lastMenstrualPeriod: lnmp || undefined, notes: f.get("notes") || undefined,
    });
    attempt.current = body; draft.pending.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ visit: { status: string } }>(`/api/visits/${active.id}/triage`, { method: "POST", body });
      if (!mounted.current || activeId.current !== savingVisitId) return;
      draft.dirty.current = false; attempt.current = null;
      const savedVisit = active;
      setActive(null); setRetry(false);
      try { await completedCallback.current(savedVisit.patient.fullName, savedVisit.id, result.visit.status); }
      catch { if (mounted.current) setError("Triage was saved, but the visit list could not refresh. Refresh the list before continuing."); }
    } catch (error) {
      if (!mounted.current || activeId.current !== savingVisitId) return;
      const uncertain = !(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500;
      setRetry(uncertain); if (!uncertain) attempt.current = null;
      setError((error as Error).message + (uncertain ? " Retry the same save to confirm its result; your entries are retained." : ""));
    } finally { draft.pending.current = false; if (mounted.current) setBusy(false); }
  }
  if (!active)
    return (
      <>
        <header className="triagePatientHeader">
          <div>
            <p className="eyebrow">Shared measurements and clinical assessment</p>
            <h1>Triage</h1>
            <p>
              Select an open visit. Record measurements, complete clinical triage, or add a repeat reading.
            </p>
          </div>
        </header>
        {error && <div role="alert" className="alert">{error}</div>}
        <section className="card">
          {visits.length === 0 ? (
            <div className="empty">
              <strong>No open visits</strong>
              <p>Newly registered visits will appear here automatically.</p>
            </div>
          ) : (
            <div className="vitalsQueueScroll" tabIndex={0} role="region" aria-label="Open visits for vitals and triage"><table className="vitalsQueue"><thead><tr><th>Patient / visit</th><th>Clinic</th><th>Current task</th><th>Priority</th><th>Action</th></tr></thead><tbody>
              {visits.filter(isOpenClinicalVisit).map(v => <tr key={v.id}><td><strong>{v.patient.fullName}</strong><small>{v.patient.patientNumber} · {v.visitNumber}</small></td><td>{v.clinic}<small>{patientClinicalGroup(v.patient).label}</small></td><td>{v.status === "AWAITING_TRIAGE" ? "Clinical triage" : "Repeat measurements"}</td><td>{v.priority}</td><td><button className="secondary" onClick={() => openVisit(v)} aria-label={`Open ${v.patient.fullName}`}>Open visit</button></td></tr>)}
            </tbody></table></div>
          )}
        </section>
      </>
    );
  if ((!currentVisit || !isOpenClinicalVisit(currentVisit)) && !retainingAssessment) return <section className="card"><p>This visit is no longer open in this worklist. No new measurements can be submitted here.</p><button onClick={leaveVisit}>Back to queue</button></section>;
  if (!canTriage) return <><header className="triagePatientHeader"><div><p className="eyebrow">Triage</p><h1>{active.patient.fullName}</h1><p>{active.patient.patientNumber} · {active.visitNumber}</p><p>Clinical triage is complete or not required for this visit. Earlier measurements remain in the history.</p></div><button className="secondary" onClick={leaveVisit}>Back to queue</button></header><VisitVitalsPanel key={active.id} visitId={active.id} capture={canCapture} /></>;
  return (
    <>
      <header className="triagePatientHeader">
        <div>
          <p className="eyebrow">Triage assessment</p>
          <h1>{active.patient.fullName}</h1>
          <p>
            {active.patient.patientNumber} · {active.visitNumber} ·{" "}
            {active.clinic}
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={leaveVisit}>
          ← Back to queue
        </button>
      </header>
      <div className={`patientBanner ${active.priority.toLowerCase()}`}>
        <div>
          <strong>Arrival priority: {active.priority}</strong>
          <span>
            {patientClinicalGroup(active.patient).label} · {active.clinic}
          </span>
        </div>
        <time>
          Arrived{" "}
          {new Date(active.arrivedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      {active.patient.allergies?.length ? (
        <div className="allergyAlert">
          <strong>Allergy alert</strong>
          {active.patient.allergies.map((a) => (
            <span key={a.substance}>
              {a.substance}
              {a.reaction ? ` — ${a.reaction}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      {active.ancAdmissionEvidence?.safeguardingReviewRequired && <div className="dangerPanel">
        <strong>Confidential safeguarding review required</strong>
        <span>This ANC client is under 15 with documented positive pregnancy confirmation. Provide private, respectful assessment, consider coercion or violence without judgement, and follow the facility child-protection pathway. Do not delay antenatal care.</span>
      </div>}
      <VisitVitalsPanel key={active.id} visitId={active.id} onUse={useMeasurements} onInitial={(values, id) => useMeasurements(values, id, true)} useDisabled={busy || retry} />
      <form key={`assessment-${active.id}`} className="card dataForm triageForm" onSubmit={submit} onChange={() => { draft.dirty.current = true; }}>
        <fieldset className="triageEntryFields wide" disabled={busy || retry}><legend>Clinical triage assessment</legend>
        {error && <div role="alert" className="alert wide">{error}</div>}
        {retainingAssessment && currentVisit?.status !== "AWAITING_TRIAGE" && <p className="wide alert">The visit status changed while this assessment was open. Your entries are retained. Retry an uncertain save to confirm it, or return to the queue to review the current visit.</p>}
        <div className="privacyNotice wide">
          <strong>Minimum necessary triage detail</strong>
          <span>
            Ask enough to identify immediate danger and route safely. Record a
            brief presenting concern or red flag here; the clinician will take
            the detailed history in private.
          </span>
        </div>
        <label className="wide">
          Presenting concern / immediate red flag *
          <textarea name="chiefComplaint" minLength={2} maxLength={500} rows={2} required placeholder="Brief reason for triage; avoid a detailed history" />
        </label>
        <fieldset className="wide vitalGrid">
          <legend>{reviewedVitalsId ? "Review recorded measurements" : "New measurements"}</legend>
          <p className="wide listHint">{reviewedVitalsId ? "Recorded values are read-only. Fill only missing measurements actually taken; completing a partial set preserves the original readings, recorder and time in a linked history entry." : "Enter the values you measured. No normal observations are prefilled. These values will be saved once with this assessment."}</p>
          {reviewedVitalsId && <button className="secondary wide" type="button" onClick={() => { if (!window.confirm("Start a new measurement set? The recorded history and your clinical assessment will be kept.")) return; setVitals(current => ({ ...blankVitals(), painScore: current.painScore, consciousness: current.consciousness })); setWeight(""); setHeight(""); setReviewedVitalsId(undefined); setSourceValues({}); draft.dirty.current = true; measurementTouched.current = true; }}>Record a new set</button>}
          <label>
            Temperature °C
            <input
              type="number"
              step="0.1"
              min="25"
              max="45"
              readOnly={locked("temperatureC")} value={vitals.temperatureC}
              onChange={(e) => vital("temperatureC", e.target.value)}
              required
            />
          </label>
          <label>
            Pulse /min
            <input
              type="number"
              min="20"
              max="300"
              readOnly={locked("pulseBpm")} value={vitals.pulseBpm}
              onChange={(e) => vital("pulseBpm", e.target.value)}
              required
            />
          </label>
          <label>
            Respirations /min
            <input
              type="number"
              min="4"
              max="100"
              readOnly={locked("respiratoryRate")} value={vitals.respiratoryRate}
              onChange={(e) => vital("respiratoryRate", e.target.value)}
              required
            />
          </label>
          <label>
            BP systolic
            <input
              type="number"
              min="40"
              max="300"
              readOnly={locked("systolicBp")} value={vitals.systolicBp}
              onChange={(e) => vital("systolicBp", e.target.value)}
              required
            />
          </label>
          <label>
            BP diastolic
            <input
              type="number"
              min="20"
              max="200"
              readOnly={locked("diastolicBp")} value={vitals.diastolicBp}
              onChange={(e) => vital("diastolicBp", e.target.value)}
              required
            />
          </label>
          <label>
            SpO₂ %
            <input
              type="number"
              min="40"
              max="100"
              readOnly={locked("oxygenSaturation")} value={vitals.oxygenSaturation}
              onChange={(e) => vital("oxygenSaturation", e.target.value)}
              required
            />
          </label>
          <label>
            Weight kg
            <input
              name="weightKg"
              readOnly={locked("weightKg")} value={weight} onChange={event => { measurementTouched.current = true; setWeight(event.target.value); }}
              type="number"
              step="0.1"
              min="0.1"
              max="500"
              required
            />
          </label>
          <label>
            Height cm
            <input
              name="heightCm"
              readOnly={locked("heightCm")} value={height} onChange={event => { measurementTouched.current = true; setHeight(event.target.value); }}
              type="number"
              step="0.1"
              min="20"
              max="260"
            />
          </label>
          {needsMeasurements && <label className="wide">{reviewedVitalsId ? "Additional measurements taken at (Nairobi)" : "Measured at (Nairobi)"}<input type="datetime-local" value={measuredAt} onChange={event => setMeasuredAt(event.target.value)} required /></label>}
          <label>
            Pain /10
            <input
              type="number"
              min="0"
              max="10"
              value={vitals.painScore}
              onChange={(e) => vital("painScore", e.target.value)}
              required
            />
          </label>
          <label className="triageConsciousness">
            Consciousness
            <select
              value={vitals.consciousness}
              onChange={(e) => vital("consciousness", e.target.value)}
              required
            >
              <option value="">Select observed response</option>
              <option value="ALERT">Alert</option>
              <option value="VOICE">Responds to voice</option>
              <option value="PAIN">Responds to pain</option>
              <option value="UNRESPONSIVE">Unresponsive</option>
            </select>
          </label>
        </fieldset>
        {alerts.length > 0 && (
          <div className="dangerPanel wide">
            <strong>Rule-based clinical alerts — assess immediately</strong>
            {alerts.map((alert) => (
              <span
                className={alert.severity.toLowerCase()}
                key={alert.message}
              >
                {alert.severity}: {alert.message}
              </span>
            ))}
            <small>
              These alerts support, but do not replace, clinical judgement or
              local emergency protocols.
            </small>
          </div>
        )}
        {patientClinicalGroup(active.patient).pregnancyQuestionsApply && (
          <>
            <label>
              Pregnancy status
              <select name="pregnancyStatus" defaultValue={active.ancAdmissionEvidence ? "PREGNANT" : "UNKNOWN"}>
                <option value="UNKNOWN">Ask privately</option>
                <option value="NOT_PREGNANT">Not pregnant</option>
                <option value="PREGNANT">Pregnant</option>
                <option value="POSSIBLY_PREGNANT">Possibly pregnant</option>
              </select>
            </label>
            <label>
              LNMP — first day of last normal menstrual period
              <input name="lastMenstrualPeriod" type="date" max={facilityToday} value={lnmp} onChange={(event) => setLnmp(event.target.value)} />
            </label>
            {pregnancyDating && <>
              <label>Estimated delivery date<input type="date" value={pregnancyDating.estimatedDeliveryDate} readOnly aria-readonly="true" /></label>
              <label>Gestational age today<input value={gestationalAgeLabel(pregnancyDating)} readOnly aria-readonly="true" /></label>
              <p className="wide listHint">Calculated automatically from LNMP using the 280-day rule. Confirm dating with ultrasound when indicated; the server stores the same facility-date calculation.</p>
            </>}
          </>
        )}
        {patientClinicalGroup(active.patient).ageGroup === "CHILD" && (
          <div className="childNotice">
            <strong>Paediatric patient</strong>
            <span>
              Use age-appropriate equipment and local paediatric observation
              ranges. Confirm the accompanying caregiver.
            </span>
          </div>
        )}
        <label>
          Triage category *
          <select name="triageCategory" defaultValue="" required>
            <option value="">Select after assessment</option>
            <option value="ROUTINE">Green · Routine</option>
            <option value="PRIORITY">Yellow · Priority</option>
            <option value="URGENT">Orange · Urgent</option>
            <option value="EMERGENCY">Red · Emergency</option>
          </select>
        </label>
        <label className="wide">
          Triage notes
          <textarea name="notes" rows={3} />
        </label>
        </fieldset>
        <div className="wide submitBar">
          <span>
            Completing triage will route this patient to consultation.
          </span>
          <button className="primary" disabled={busy}>{busy ? "Saving triage…" : retry ? "Retry same triage save" : "Complete triage"}</button>
        </div>
      </form>
    </>
  );
}
