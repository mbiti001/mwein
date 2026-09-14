"use client";

import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  careServiceForClinic,
  careServiceProfile,
  careServiceProfiles,
  referralNextStatuses,
  type CareField,
  type CareServiceProfile,
} from "@/lib/care-service-points";
import { jsonRequest } from "@/lib/client-http";

type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  sexAtBirth: string;
  dateOfBirth?: string | null;
  estimatedAgeYears?: number | null;
  allergies?: { substance: string; reaction?: string | null }[];
};

type Visit = {
  id: string;
  visitNumber: string;
  clinic: string;
  visitType?: string;
  priority: string;
  status: string;
  arrivedAt: string;
  patient: Patient;
  ancAdmissionEvidence?: {
    result: string;
    method: string;
    testedAt: string;
    evidenceReference: string;
    consentConfirmed: boolean;
    safeguardingReviewRequired: boolean;
    recordedAt: string;
  } | null;
  encounters?: { diagnoses: { description: string; code?: string | null; primary: boolean }[] }[];
  orders?: {
    id: string;
    type: string;
    status: string;
    displayName: string;
    laboratory?: {
      testCode: string;
      accessionNumber?: string | null;
      result?: { id: string; status: string; verifiedAt?: string | null } | null;
    } | null;
    imaging?: {
      modality: string;
      examinationCode: string;
      result?: { id: string; status: string; verifiedAt?: string | null } | null;
    } | null;
  }[];
};

type ReferralAttachmentOption = {
  order: NonNullable<Visit["orders"]>[number];
  sourceType: "LABORATORY_RESULT" | "IMAGING_RESULT";
  resultId: string;
};

type Metric = {
  waiting: number;
  beingSeen: number;
  completed: number;
  pendingInvestigations: number;
  followUps: number;
  referrals: number;
};

type ServiceRecord = {
  id: string;
  servicePoint: string;
  templateVersion: string;
  data: Record<string, string | boolean>;
  riskLevel?: string | null;
  followUpAt?: string | null;
  updatedAt: string;
};

type Relationship = {
  id: string;
  relationship: string;
  patient: { id: string; patientNumber: string; fullName: string };
  relatedPatient: { id: string; patientNumber: string; fullName: string };
};

export type Referral = {
  id: string;
  referralNumber: string;
  type: string;
  referrerName: string;
  referringFacility: string;
  referringDepartment?: string | null;
  reason: string;
  clinicalSummary: string;
  diagnosisSummary: string;
  urgency: string;
  attachments: {
    id: string;
    sourceType: "LABORATORY_RESULT" | "IMAGING_RESULT";
    resultId: string;
    href: string;
    metadataVersion: number;
    metadata: {
      displayName: string;
      orderId: string;
      resultStatus: string;
      verifiedAt?: string | null;
      testCode?: string;
      accessionNumber?: string | null;
      examinationCode?: string;
      modality?: string;
    };
    attachedAt: string;
    attachedBy: { displayName: string };
  }[];
  acknowledgements: {
    id: string;
    eventType: "ACCEPTED" | "ATTENDED" | "RETURNED";
    referralStatus: string;
    providerName: string;
    providerRole?: string | null;
    registrationNumber?: string | null;
    note?: string | null;
    acknowledgedAt: string;
    recordedAt: string;
    recordedBy: { displayName: string };
  }[];
  receivingFacility: string;
  receivingDepartment?: string | null;
  appointmentAt?: string | null;
  status: string;
  feedback?: string | null;
  createdAt: string;
  patient: Patient;
  visit: { id: string; visitNumber: string; clinic: string; arrivedAt: string };
  createdBy: { displayName: string };
  updatedBy: { displayName: string };
};

async function api<T>(url: string, options?: RequestInit) {
  return jsonRequest<T>(url, options);
}

function emptyMetric(): Metric {
  return { waiting: 0, beingSeen: 0, completed: 0, pendingInvestigations: 0, followUps: 0, referrals: 0 };
}

export default function ServicePointsWorkstation({
  visits,
  initialVisitId,
  onInitialVisitOpened,
  onOpenClinical,
  onUpdated,
}: {
  visits: Visit[];
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
  onOpenClinical: (visitId: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const initialVisit = visits.find((visit) => visit.id === initialVisitId);
  const initialProfile = initialVisit ? careServiceForClinic(initialVisit.clinic) : undefined;
  const [selectedCode, setSelectedCode] = useState(initialVisit ? initialProfile?.code || "REFERRAL" : "ANC");
  const [activeVisit, setActiveVisit] = useState<Visit | null>(initialProfile ? initialVisit || null : null);
  const [referralVisitId, setReferralVisitId] = useState<string | null>(initialVisit && !initialProfile ? initialVisit.id : null);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function loadMetrics() {
    const result = await api<{ metrics: Record<string, Metric> }>("/api/service-points");
    setMetrics(result.metrics);
  }

  useEffect(() => {
    void loadMetrics().catch((reason) => setError((reason as Error).message));
    const refresh = () => {
      if (document.visibilityState === "visible")
        void loadMetrics().catch((reason) => setError((reason as Error).message));
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!initialVisitId) return;
    const visit = visits.find((item) => item.id === initialVisitId);
    const profile = visit ? careServiceForClinic(visit.clinic) : undefined;
    if (visit) {
      if (profile) {
        setSelectedCode(profile.code);
        setActiveVisit(visit);
        setReferralVisitId(null);
      } else {
        setSelectedCode("REFERRAL");
        setActiveVisit(null);
        setReferralVisitId(visit.id);
      }
      onInitialVisitOpened?.();
    }
  }, [initialVisitId, onInitialVisitOpened, visits]);

  const selectedProfile = careServiceProfile(selectedCode)!;
  const matchingVisits = useMemo(() => {
    const term = query.trim().toLowerCase();
    return visits
      .filter((visit) => careServiceForClinic(visit.clinic)?.code === selectedCode)
      .filter((visit) => !term || `${visit.patient.fullName} ${visit.patient.patientNumber} ${visit.visitNumber}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [query, selectedCode, visits]);

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Connected clinical care</p>
          <h1>Service points</h1>
          <p>Specialty workflows use the same patient, visit, orders, results, prescription, invoice and audit trail.</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      <section className="careServiceGrid" aria-label="Clinical service points">
        {careServiceProfiles.map((profile) => {
          const metric = metrics[profile.code] || emptyMetric();
          return (
            <button
              type="button"
              className={`careServiceCard ${selectedCode === profile.code ? "active" : ""}`}
              style={{ "--service-accent": profile.accent } as CSSProperties}
              onClick={() => { setSelectedCode(profile.code); setActiveVisit(null); setReferralVisitId(null); setQuery(""); setError(""); }}
              key={profile.code}
            >
              <span className="careServiceIcon" aria-hidden="true">{profile.label.slice(0, 2).toUpperCase()}</span>
              <div><strong>{profile.label}</strong><small>{profile.description}</small></div>
              <b>{metric.waiting}</b>
              <span className="careServiceStats">{profile.code === "REFERRAL" ? `${metric.beingSeen} active · ${metric.completed} returned/closed today · ${metric.referrals} sent today` : `${metric.beingSeen} active · ${metric.pendingInvestigations} tests · ${metric.followUps} follow-ups`}</span>
            </button>
          );
        })}
      </section>

      {selectedProfile.code === "REFERRAL" ? (
        <ReferralWorkspace
          visits={visits}
          initialVisitId={referralVisitId}
          onInitialVisitOpened={() => setReferralVisitId(null)}
          onMetricsChanged={loadMetrics}
        />
      ) : activeVisit ? (
        <AssessmentWorkspace
          key={`${activeVisit.id}:${selectedProfile.code}`}
          visit={activeVisit}
          profile={selectedProfile}
          onBack={() => setActiveVisit(null)}
          onOpenClinical={() => onOpenClinical(activeVisit.id)}
          onSaved={async () => { await Promise.all([loadMetrics(), onUpdated()]); }}
        />
      ) : (
        <section className="card compact careQueue">
          <div className="cardHead"><div><h2>{selectedProfile.label} work queue</h2><p>Only open visits checked into this service are shown.</p></div><span className="templateBadge">{selectedProfile.templateVersion}</span></div>
          <label className="listSearch">Find patient in this queue<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Patient name, number or visit" /></label>
          <p className="listCount">Showing {matchingVisits.length} matching patient{matchingVisits.length === 1 ? "" : "s"}; the list is capped at eight.</p>
          {matchingVisits.length ? <div className="queue">{matchingVisits.map((visit) => (
            <button type="button" className={`row ${visit.priority.toLowerCase()}`} key={visit.id} onClick={() => setActiveVisit(visit)}>
              <span className="dot" /><div><strong>{visit.patient.fullName}</strong><small>{visit.patient.patientNumber} · {visit.visitNumber} · {visit.status.replaceAll("_", " ")}</small></div><b>{visit.priority}</b><time>{new Date(visit.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </button>
          ))}</div> : <div className="empty"><strong>No matching {selectedProfile.label} visits</strong><p>Check the patient into {selectedProfile.clinic} at reception; they will appear here automatically.</p></div>}
        </section>
      )}
    </>
  );
}

function AssessmentWorkspace({
  visit,
  profile,
  onBack,
  onOpenClinical,
  onSaved,
}: {
  visit: Visit;
  profile: CareServiceProfile;
  onBack: () => void;
  onOpenClinical: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [riskLevel, setRiskLevel] = useState("ROUTINE");
  const [followUpAt, setFollowUpAt] = useState("");
  const [record, setRecord] = useState<ServiceRecord | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setBusy(true);
    try {
      const response = await api<{ record: ServiceRecord | null; relationships: Relationship[] }>(`/api/service-points?visitId=${visit.id}`);
      setRecord(response.record);
      setValues(response.record?.data || {});
      setRiskLevel(response.record?.riskLevel || "ROUTINE");
      setFollowUpAt(response.record?.followUpAt?.slice(0, 10) || "");
      setRelationships(response.relationships);
      setSaved(Boolean(response.record));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  function change(key: string, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await api<{ record: ServiceRecord }>("/api/service-points", {
        method: "POST",
        body: JSON.stringify({
          action: "SAVE_ASSESSMENT",
          visitId: visit.id,
          servicePoint: profile.code,
          templateVersion: profile.templateVersion,
          data: values,
          riskLevel,
          followUpAt: followUpAt || undefined,
        }),
      });
      setRecord(response.record);
      setSaved(true);
      setNotice(`${profile.label} assessment saved in this patient's encounter.`);
      await onSaved();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="servicePatientHeader">
        <div><p className="eyebrow">{profile.label} assessment</p><h1>{visit.patient.fullName}</h1><p>{visit.patient.patientNumber} · {visit.visitNumber} · {visit.clinic}</p></div>
        <div className="actions"><button className="secondary" type="button" onClick={onBack}>← Queue</button><button className="primary" type="button" onClick={onOpenClinical}>Diagnosis, orders &amp; sign →</button></div>
      </header>
      <section className="clinicalSummary serviceSafetyStrip">
        <div><small>Priority</small><strong>{visit.priority}</strong></div>
        <div><small>Visit state</small><strong>{visit.status.replaceAll("_", " ")}</strong></div>
        <div><small>Allergies</small><strong className={visit.patient.allergies?.length ? "dangerText" : ""}>{visit.patient.allergies?.length ? visit.patient.allergies.map((item) => item.substance).join(", ") : "None recorded—verify"}</strong></div>
        <div><small>Template</small><strong>{profile.templateVersion}</strong></div>
      </section>
      {profile.code === "ANC" && visit.ancAdmissionEvidence && <section className={`clinicalBoundary ${visit.ancAdmissionEvidence.safeguardingReviewRequired ? "emergencyPanel" : ""}`}>
        <strong>Pregnancy confirmed</strong>
        <span>{visit.ancAdmissionEvidence.method.replaceAll("_", " ").toLowerCase()} · tested {new Date(visit.ancAdmissionEvidence.testedAt).toLocaleDateString()} · reference {visit.ancAdmissionEvidence.evidenceReference}.{visit.ancAdmissionEvidence.safeguardingReviewRequired ? " Provide a private, non-judgemental safeguarding assessment now; do not delay ANC." : " Continue WHO-aligned ANC assessment."}</span>
      </section>}
      {profile.code === "MCH_PNC" && <PatientLinkPanel visit={visit} relationships={relationships} onLinked={load} />}
      <form className="serviceAssessment" onSubmit={submit}>
        {error && <div className="alert">{error}</div>}
        {notice && <div className="inlineSaveConfirmation" role="status">✓ {notice}</div>}
        <div className="clinicalBoundary">
          <strong>One connected record</strong>
          <span>Use this form for specialty observations. Diagnoses, laboratory/imaging orders and results, prescriptions, billing, referrals and visit completion stay in their shared workspaces.</span>
        </div>
        {busy && !record ? <div className="empty"><strong>Opening assessment…</strong></div> : profile.sections.map((section, index) => (
          <details className="card serviceSection" open={index === 0 ? true : undefined} key={section.title}>
            <summary><span><strong>{section.title}</strong>{section.description && <small>{section.description}</small>}</span><b>Open</b></summary>
            <div className="dataForm serviceFields">
              {section.fields.map((field) => <AssessmentField key={field.key} field={field} value={values[field.key]} onChange={(value) => change(field.key, value)} />)}
            </div>
          </details>
        ))}
        <section className="card servicePlanBar">
          <label>Clinical risk *<select value={riskLevel} onChange={(event) => { setRiskLevel(event.target.value); setSaved(false); }}><option value="ROUTINE">Routine</option><option value="INCREASED">Increased</option><option value="HIGH">High risk</option><option value="EMERGENCY">Emergency action</option></select></label>
          <label>Next follow-up<input type="date" value={followUpAt} onChange={(event) => { setFollowUpAt(event.target.value); setSaved(false); }} /></label>
          <div className="serviceSave">{saved ? <span className="inlineSaveConfirmation">✓ Saved {record?.updatedAt ? new Date(record.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span> : <button className="primary" disabled={busy}>{busy ? "Saving…" : `Save ${profile.label} assessment`}</button>}</div>
        </section>
      </form>
    </>
  );
}

function AssessmentField({ field, value, onChange }: { field: CareField; value?: string | boolean; onChange: (value: string | boolean) => void }) {
  const label = <>{field.label}{field.required ? " *" : ""}{field.unit && <small>{field.unit}</small>}</>;
  if (field.type === "textarea") return <label className="wide">{label}<textarea rows={3} required={field.required} value={String(value || "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} /></label>;
  if (field.type === "select") return <label>{label}<select required={field.required} value={String(value || "")} onChange={(event) => onChange(event.target.value)}><option value="">Select</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
  if (field.type === "checkbox") return <label className="checkField"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
  return <label>{label}<input type={field.type} required={field.required} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? "any" : undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} /></label>;
}

function PatientLinkPanel({ visit, relationships, onLinked }: { visit: Visit; relationships: Relationship[]; onLinked: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [relationship, setRelationship] = useState("MOTHER_OF");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = relationships.map((item) => item.patient.id === visit.patient.id ? { patient: item.relatedPatient, relationship: item.relationship } : { patient: item.patient, relationship: `LINKED AS ${item.relationship}` });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (query.trim().length < 2) return setMatches([]);
      api<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((result) => setMatches(result.patients.filter((patient) => patient.id !== visit.patient.id).slice(0, 6)))
        .catch((reason) => { if ((reason as Error).name !== "AbortError") setError((reason as Error).message); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, visit.patient.id]);

  return <details className="card patientLinkPanel"><summary><span><strong>Mother and child record link</strong><small>{linked.length ? `${linked.length} linked record${linked.length === 1 ? "" : "s"}` : "Link records once; do not create duplicate patients"}</small></span><b>Open</b></summary><div className="managementBody">
    {error && <div className="alert">{error}</div>}
    {linked.map((item) => <div className="summaryLine" key={`${item.patient.id}:${item.relationship}`}><strong>{item.patient.fullName}</strong><span>{item.patient.patientNumber} · {item.relationship.replaceAll("_", " ")}</span></div>)}
    <div className="dataForm linkPatientForm"><label className="wide">Find the existing mother or child<input type="search" value={selected ? selected.fullName : query} onChange={(event) => { setSelected(null); setQuery(event.target.value); }} placeholder="Name, patient number or phone" />{!selected && matches.map((patient) => <button className="patientResult" type="button" key={patient.id} onClick={() => { setSelected(patient); setMatches([]); }}><strong>{patient.fullName}</strong><span>{patient.patientNumber}</span></button>)}</label><label>Relationship from {visit.patient.fullName}<select value={relationship} onChange={(event) => setRelationship(event.target.value)}><option value="MOTHER_OF">Mother of</option><option value="CHILD_OF">Child of</option><option value="GUARDIAN_OF">Guardian of</option><option value="DEPENDANT_OF">Dependant of</option></select></label><div className="serviceSave">{selected && <button className="secondary" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/api/service-points", { method: "POST", body: JSON.stringify({ action: "LINK_PATIENT", visitId: visit.id, relatedPatientId: selected.id, relationship }) }); setSelected(null); setQuery(""); await onLinked(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }}>{busy ? "Linking…" : "Link patient records"}</button>}</div></div>
  </div></details>;
}

function ReferralWorkspace({
  visits,
  initialVisitId,
  onInitialVisitOpened,
  onMetricsChanged,
}: {
  visits: Visit[];
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
  onMetricsChanged: () => Promise<void>;
}) {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [query, setQuery] = useState("");
  const [visitQuery, setVisitQuery] = useState("");
  const [visit, setVisit] = useState<Visit | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Referral | null>(null);
  const [printReferral, setPrintReferral] = useState<Referral | null>(null);
  const [error, setError] = useState("");
  const filteredVisits = visits.filter((item) => {
    const term = visitQuery.trim().toLowerCase();
    return term.length >= 2 && `${item.patient.fullName} ${item.patient.patientNumber} ${item.visitNumber}`.toLowerCase().includes(term);
  }).slice(0, 6);
  const verifiedAttachments = (visit?.orders || []).map((order): ReferralAttachmentOption | null => {
    if (order.type === "LABORATORY" && order.laboratory?.result?.status === "VERIFIED")
      return { order, sourceType: "LABORATORY_RESULT", resultId: order.laboratory.result.id };
    if (order.type === "IMAGING" && order.imaging?.result?.status === "VERIFIED")
      return { order, sourceType: "IMAGING_RESULT", resultId: order.imaging.result.id };
    return null;
  }).filter((item): item is ReferralAttachmentOption => item !== null);

  async function load() {
    const result = await api<{ referrals: Referral[] }>(`/api/referrals?q=${encodeURIComponent(query)}`);
    setReferrals(result.referrals);
  }
  useEffect(() => { const timer = window.setTimeout(() => void load().catch((reason) => setError((reason as Error).message)), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        void load().catch((reason) => setError((reason as Error).message));
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [query]);
  useEffect(() => {
    if (!initialVisitId) return;
    const selectedVisit = visits.find((item) => item.id === initialVisitId);
    if (selectedVisit) {
      setVisit(selectedVisit);
      setVisitQuery("");
      setCreated(null);
      onInitialVisitOpened?.();
    }
  }, [initialVisitId, onInitialVisitOpened, visits]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visit) return setError("Select the patient visit first");
    setBusy(true); setError(""); setCreated(null);
    const form = new FormData(event.currentTarget);
    try {
      const appointment = String(form.get("appointmentAt") || "");
      const result = await api<{ referral: Referral }>("/api/referrals", { method: "POST", body: JSON.stringify({
        visitId: visit.id,
        idempotencyKey: key,
        type: form.get("type"),
        referringDepartment: form.get("referringDepartment") || undefined,
        reason: form.get("reason"),
        clinicalSummary: form.get("clinicalSummary"),
        diagnosisSummary: form.get("diagnosisSummary"),
        urgency: form.get("urgency"),
        attachments: form.getAll("attachments").map((value) => {
          const [sourceType, resultId] = String(value).split(":");
          return { sourceType, resultId };
        }),
        receivingFacility: form.get("receivingFacility"),
        receivingDepartment: form.get("receivingDepartment") || undefined,
        appointmentAt: appointment ? new Date(appointment).toISOString() : undefined,
      }) });
      setCreated(result.referral); setPrintReferral(result.referral); setKey(crypto.randomUUID()); setVisit(null); setVisitQuery(""); event.currentTarget.reset();
      await Promise.all([load(), onMetricsChanged()]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function print(item: Referral) {
    setPrintReferral(item);
    window.setTimeout(() => {
      document.body.classList.add("printingReferral");
      window.print();
      document.body.classList.remove("printingReferral");
    });
  }

  return <>
    <details className="card managementPanel referralCreate" open>
      <summary><span><strong>Create referral</strong><small>Choose an active patient visit; clinical content remains linked to that encounter.</small></span><b>Open</b></summary>
      <form className="dataForm managementBody" onSubmit={create}>
        {error && <div className="alert wide">{error}</div>}
        {created && <div className="inlineSaveConfirmation wide">✓ {created.referralNumber} saved as draft. Review, print or send it below.</div>}
        {visit ? <div className="patientBanner wide"><div><strong>{visit.patient.fullName}</strong><span>{visit.patient.patientNumber} · {visit.visitNumber} · {visit.clinic}</span></div><button type="button" onClick={() => { setVisit(null); setCreated(null); }}>Change patient</button></div> : <label className="wide">Find active patient visit *<input type="search" value={visitQuery} onChange={(event) => setVisitQuery(event.target.value)} placeholder="Patient name, number or visit" />{filteredVisits.map((item) => <button className="patientResult" type="button" key={item.id} onClick={() => { setVisit(item); setCreated(null); setVisitQuery(""); }}><strong>{item.patient.fullName}</strong><span>{item.patient.patientNumber} · {item.visitNumber}</span></button>)}</label>}
        <label>Referral type *<select name="type" defaultValue="EXTERNAL"><option value="INTERNAL">Internal</option><option value="EXTERNAL">External</option></select></label>
        <label>Referring department<input name="referringDepartment" maxLength={120} placeholder="Clinic or service" /></label>
        <label>Urgency *<select name="urgency" defaultValue="ROUTINE"><option value="ROUTINE">Routine</option><option value="PRIORITY">Priority</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option></select></label>
        <label>Appointment date and time<input name="appointmentAt" type="datetime-local" /></label>
        <label>Receiving facility *<input name="receivingFacility" required minLength={2} maxLength={240} /></label>
        <label>Receiving department<input name="receivingDepartment" maxLength={160} /></label>
        <label className="wide">Reason for referral *<textarea name="reason" required minLength={3} rows={2} /></label>
        <label className="wide">Diagnosis / clinical indication *<textarea key={visit?.id || "none"} name="diagnosisSummary" required minLength={2} rows={2} defaultValue={visit?.encounters?.[0]?.diagnoses.map((item) => `${item.code || ""} ${item.description}`.trim()).join("; ") || ""} /></label>
        <label className="wide">Clinical summary and treatment given *<textarea name="clinicalSummary" required minLength={10} rows={4} /></label>
        {visit && <fieldset className="wide referralAttachments"><legend>Attach verified findings</legend>{verifiedAttachments.length ? verifiedAttachments.slice(0, 20).map(({ order, sourceType, resultId }) => <label key={resultId}><input type="checkbox" name="attachments" value={`${sourceType}:${resultId}`} /><span>{order.displayName}<small>{sourceType === "LABORATORY_RESULT" ? `Laboratory · ${order.laboratory?.accessionNumber || order.laboratory?.testCode || "verified"}` : `Imaging · ${order.imaging?.modality || "verified"}`} · immutable source link</small></span></label>) : <p className="attachmentEmpty">No verified laboratory or imaging results are available for this visit.</p>}</fieldset>}
        <div className="wide submitBar"><span>The referral starts as a draft so it can be checked before sending.</span>{created ? <span className="inlineSaveConfirmation">✓ Draft created</span> : <button className="primary" disabled={busy || !visit}>{busy ? "Creating…" : "Create referral draft"}</button>}</div>
      </form>
    </details>
    <section className="card compact referralTracker">
      <div className="cardHead"><div><h2>Referral tracking</h2><p>Searchable status board with receiving-provider feedback.</p></div></div>
      <label className="listSearch">Find referral<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Patient, referral number, facility or department" /></label>
      <p className="listCount">Showing {Math.min(referrals.length, 12)} of {referrals.length} matching referrals.</p>
      {referrals.length ? <div className="referralList">{referrals.slice(0, 12).map((item) => <ReferralRow key={item.id} referral={item} onUpdated={async () => { await Promise.all([load(), onMetricsChanged()]); }} onPrint={() => print(item)} />)}</div> : <div className="empty"><strong>No matching referrals</strong><p>Create the referral from an active patient visit.</p></div>}
    </section>
    {printReferral && <ReferralLetter referral={printReferral} />}
  </>;
}

export function ReferralRow({ referral, onUpdated, onPrint }: { referral: Referral; onUpdated: () => Promise<void>; onPrint: () => void }) {
  const [feedback, setFeedback] = useState(referral.feedback || "");
  const [providerName, setProviderName] = useState("");
  const [providerRole, setProviderRole] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [acknowledgementNote, setAcknowledgementNote] = useState("");
  const [acknowledgedAt, setAcknowledgedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = referralNextStatuses(referral.status);
  const receivingStatuses = ["ACCEPTED", "ATTENDED", "RETURNED"];
  const needsAcknowledgement = next.some((status) => receivingStatuses.includes(status));
  async function move(status: string) {
    if (receivingStatuses.includes(status) && providerName.trim().length < 2) {
      setError("Enter the receiving provider's name before recording this event");
      return;
    }
    setBusy(true); setError("");
    try {
      await api(`/api/referrals/${referral.id}`, { method: "PATCH", body: JSON.stringify({
        status,
        feedback: feedback || undefined,
        acknowledgement: receivingStatuses.includes(status) ? {
          providerName,
          providerRole: providerRole || undefined,
          registrationNumber: registrationNumber || undefined,
          note: acknowledgementNote || undefined,
          acknowledgedAt: acknowledgedAt ? new Date(acknowledgedAt).toISOString() : undefined,
        } : undefined,
      }) });
      setProviderName(""); setProviderRole(""); setRegistrationNumber(""); setAcknowledgementNote(""); setAcknowledgedAt("");
      await onUpdated();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <details className={`referralRow ${referral.urgency.toLowerCase()}`}><summary><span className="dot" /><span><strong>{referral.patient.fullName}</strong><small>{referral.patient.patientNumber} · {referral.referralNumber} · To {referral.receivingFacility}</small></span><b>{referral.status}</b><time>{new Date(referral.createdAt).toLocaleDateString()}</time></summary><div className="referralDetails">
    {error && <div className="alert">{error}</div>}
    <div className="summaryLine"><strong>Reason</strong><span>{referral.reason}</span></div><div className="summaryLine"><strong>Diagnosis</strong><span>{referral.diagnosisSummary}</span></div><div className="summaryLine"><strong>Clinical summary</strong><span>{referral.clinicalSummary}</span></div>
    {referral.attachments.length ? <section className="referralLinkedRecords" aria-label="Attached clinical records"><h3>Attached findings</h3>{referral.attachments.map((attachment) => <a href={attachment.href} target="_blank" rel="noreferrer" key={attachment.id}><span><strong>{attachment.metadata.displayName}</strong><small>{attachment.sourceType === "LABORATORY_RESULT" ? "Laboratory result" : "Imaging report"} · metadata v{attachment.metadataVersion} · verified {attachment.metadata.verifiedAt ? new Date(attachment.metadata.verifiedAt).toLocaleString() : "before attachment"}</small></span><b>Open source record ↗</b></a>)}</section> : null}
    {referral.acknowledgements.length ? <section className="referralAcknowledgements" aria-label="Receiving-provider acknowledgement trail"><h3>Receiving-provider acknowledgement trail</h3><ol>{referral.acknowledgements.map((acknowledgement) => <li key={acknowledgement.id}><span className="ackEvent">{acknowledgement.eventType.replaceAll("_", " ")}</span><div><strong>{acknowledgement.providerName}</strong>{acknowledgement.providerRole && <span>{acknowledgement.providerRole}</span>}{acknowledgement.registrationNumber && <small>Registration {acknowledgement.registrationNumber}</small>}{acknowledgement.note && <p>{acknowledgement.note}</p>}<small>{new Date(acknowledgement.acknowledgedAt).toLocaleString()} · recorded by {acknowledgement.recordedBy.displayName}</small></div></li>)}</ol></section> : null}
    {needsAcknowledgement && <fieldset className="receiverAcknowledgement"><legend>Receiving-provider acknowledgement *</legend><div className="dataForm"><label>Provider name *<input value={providerName} onChange={(event) => setProviderName(event.target.value)} minLength={2} maxLength={160} placeholder="Clinician receiving the referral" /></label><label>Role<input value={providerRole} onChange={(event) => setProviderRole(event.target.value)} maxLength={120} placeholder="Consultant, medical officer…" /></label><label>Registration number<input value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} maxLength={120} /></label><label>Acknowledged at<input type="datetime-local" value={acknowledgedAt} onChange={(event) => setAcknowledgedAt(event.target.value)} /></label><label className="wide">Acknowledgement note<textarea rows={2} value={acknowledgementNote} onChange={(event) => setAcknowledgementNote(event.target.value)} maxLength={1000} /></label></div></fieldset>}
    {(next.includes("RETURNED") || referral.feedback) && <label>Receiving-provider feedback{next.includes("RETURNED") ? " *" : ""}<textarea rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} readOnly={!next.includes("RETURNED")} /></label>}
    <div className="actions"><button className="secondary" type="button" onClick={onPrint}>Print letter</button>{next.map((status) => <button className={status === "SENT" || status === "CLOSED" ? "primary" : "secondary"} type="button" disabled={busy} key={status} onClick={() => void move(status)}>{busy ? "Updating…" : status === "RETURNED" ? "Record feedback & return" : status.replaceAll("_", " ")}</button>)}</div>
  </div></details>;
}

function ReferralLetter({ referral }: { referral: Referral }) {
  return <article className="referralLetter" aria-label="Printable referral letter">
    <header><div><p className="eyebrow">{referral.referringFacility}</p><h1>Clinical referral</h1><p>{referral.referralNumber}</p></div><strong>{referral.urgency}</strong></header>
    <section className="summaryIdentity"><div><small>Patient</small><strong>{referral.patient.fullName}</strong><span>{referral.patient.patientNumber}</span></div><div><small>Visit</small><strong>{referral.visit.visitNumber}</strong><span>{referral.visit.clinic}</span></div><div><small>Referral type</small><strong>{referral.type}</strong><span>{new Date(referral.createdAt).toLocaleString()}</span></div><div><small>Appointment</small><strong>{referral.appointmentAt ? new Date(referral.appointmentAt).toLocaleString() : "Not scheduled"}</strong></div></section>
    <section><h2>Referred to</h2><p><strong>{referral.receivingFacility}</strong>{referral.receivingDepartment ? ` · ${referral.receivingDepartment}` : ""}</p></section>
    <section><h2>Reason and diagnosis</h2><p>{referral.reason}</p><p><strong>Diagnosis / indication:</strong> {referral.diagnosisSummary}</p></section>
    <section><h2>Clinical summary and treatment</h2><p>{referral.clinicalSummary}</p></section>
    {referral.attachments.length ? <section><h2>Attached findings</h2><ul>{referral.attachments.map((attachment) => <li key={attachment.id}>{attachment.metadata.displayName} — {attachment.sourceType === "LABORATORY_RESULT" ? "laboratory result" : "imaging report"} ({attachment.resultId}; metadata v{attachment.metadataVersion})</li>)}</ul></section> : null}
    {referral.acknowledgements.length ? <section><h2>Receiving-provider acknowledgements</h2><ul>{referral.acknowledgements.map((item) => <li key={item.id}>{item.eventType}: {item.providerName}{item.providerRole ? `, ${item.providerRole}` : ""} — {new Date(item.acknowledgedAt).toLocaleString()}</li>)}</ul></section> : null}
    <footer><div><small>Referrer</small><strong>{referral.referrerName}</strong><span>{referral.referringDepartment || "Clinical service"}</span></div><div><small>Receiving-provider feedback</small><span>{referral.feedback || "________________________________________________________________"}</span></div></footer>
  </article>;
}
