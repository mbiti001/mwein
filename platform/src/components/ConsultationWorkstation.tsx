"use client";

import { useEffect, useState } from "react";
import { patientClinicalGroup } from "@/lib/domain";
import { jsonRequest } from "@/lib/client-http";
import { calculateDispenseQuantity } from "@/lib/medication";
import {
  SearchableMultiPicker,
  SearchablePicker,
} from "@/components/SearchablePicker";

type Visit = {
  id: string;
  visitNumber: string;
  clinic: string;
  priority: string;
  status?: string;
  arrivedAt: string;
  patient: {
    id: string;
    fullName: string;
    patientNumber: string;
    sexAtBirth: "FEMALE" | "MALE" | "INTERSEX" | "UNKNOWN";
    dateOfBirth?: string | null;
    estimatedAgeYears?: number | null;
    allergies?: {
      substance: string;
      reaction?: string | null;
      severity?: string | null;
    }[];
  };
  triage?: {
    triageCategory: string;
    observations: {
      code: string;
      valueDecimal?: string | null;
      valueText?: string | null;
      unit?: string | null;
    }[];
  } | null;
  encounters?: {
    id?: string;
    status?: string;
    subjective?: string | null;
    objective?: string | null;
    plan?: string | null;
    diagnoses: {
      id?: string;
      code?: string | null;
      description: string;
      primary: boolean;
      type?: string;
    }[];
  }[];
  orders?: { id: string; type: string; status: string; displayName: string; clinicalIndication?: string | null; prescription?: { id?: string; medicineCode: string; genericName?: string | null; strength?: string | null; dosageForm?: string | null; dose: string; route: string; frequency: string; duration?: string | null; quantity: string; instructions: string; dispenseStatus: string } | null }[];
};
type CatalogItem = {
  code: string;
  name: string;
  category: "LABORATORY_TEST" | "PROCEDURE" | "PHARMACEUTICAL";
  unitPrice: string;
  active: boolean;
  genericName?: string | null;
  medicationConceptId?: string | null;
  therapeuticClass?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
};
type DuplicateConflict = {
  code: "EXACT_DUPLICATE" | "SAME_VISIT_DUPLICATE";
  existingOrderId: string;
  existingPrescriptionId: string;
  existing: Record<string, unknown>;
};
type DiagnosisSearchResult = {
  code: string;
  title: string;
  foundationUri?: string;
  source: string;
};
type HistoryVisit = {
  id: string;
  visitNumber: string;
  clinic: string;
  arrivedAt: string;
  status: string;
  encounters: {
    diagnoses: {
      description: string;
      code?: string | null;
      primary: boolean;
    }[];
  }[];
  orders: {
    type: string;
    displayName: string;
    prescription?: {
      genericName?: string | null;
      strength?: string | null;
      dose: string;
      frequency: string;
      duration?: string | null;
      dispenseStatus: string;
    } | null;
    laboratory?: {
      result?: {
        status: string;
        items: {
          analyte: string;
          value: string;
          unit?: string | null;
          flag?: string | null;
        }[];
      } | null;
    } | null;
    imaging?: { result?: { status: string; conclusion: string } | null } | null;
  }[];
};
function parseRecord(value?: string | null): Record<string, string> {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
function parseFindings(value?: string) {
  return Object.fromEntries(
    (value || "")
      .split("\n")
      .map((line) => line.split(": "))
      .filter((parts) => parts.length > 1)
      .map(([label, ...rest]) => [label, rest.join(": ")]),
  );
}

async function post(url: string, body: unknown) {
  return jsonRequest<Record<string, any>>(
    url,
    { method: "POST", body: JSON.stringify(body) },
    "The consultation could not be saved",
  );
}

type FindingDefinition = {
  key: string;
  label: string;
  options: readonly string[];
};
const reviewSystems: FindingDefinition[] = [
  {
    key: "fever",
    label: "Fever",
    options: [
      "Not asked",
      "Denied",
      "Subjective fever",
      "Measured fever",
      "Fever with chills / rigors",
    ],
  },
  {
    key: "weight",
    label: "Weight change",
    options: [
      "Not asked",
      "No unintended change",
      "Unintended weight loss",
      "Unintended weight gain",
    ],
  },
  {
    key: "cough",
    label: "Cough",
    options: [
      "Not asked",
      "Denied",
      "Dry",
      "Productive",
      "Barking",
      "Paroxysmal / whooping",
    ],
  },
  {
    key: "sputum",
    label: "Sputum",
    options: [
      "Not asked",
      "None",
      "Mucoid",
      "Purulent",
      "Blood-streaked",
      "Frank haemoptysis",
    ],
  },
  {
    key: "dyspnoea",
    label: "Breathlessness",
    options: [
      "Not asked",
      "Denied",
      "On exertion",
      "At rest",
      "Orthopnoea",
      "Paroxysmal nocturnal dyspnoea",
    ],
  },
  {
    key: "wheeze",
    label: "Wheeze",
    options: ["Not asked", "Denied", "Intermittent", "Persistent", "Nocturnal"],
  },
  {
    key: "chest_pain",
    label: "Chest pain",
    options: [
      "Not asked",
      "Denied",
      "Central / exertional",
      "Pleuritic",
      "Positional",
      "Reproducible on palpation",
      "Other",
    ],
  },
  {
    key: "palpitations",
    label: "Palpitations",
    options: [
      "Not asked",
      "Denied",
      "Regular rapid",
      "Irregular",
      "With syncope / presyncope",
    ],
  },
  {
    key: "oedema_symptom",
    label: "Swelling",
    options: [
      "Not asked",
      "Denied",
      "Unilateral leg",
      "Bilateral legs",
      "Facial / periorbital",
      "Generalised",
    ],
  },
  {
    key: "vomiting",
    label: "Nausea / vomiting",
    options: [
      "Not asked",
      "Denied",
      "Nausea only",
      "Vomiting",
      "Bilious vomiting",
      "Haematemesis",
      "Vomits everything",
    ],
  },
  {
    key: "abdominal_pain",
    label: "Abdominal pain",
    options: [
      "Not asked",
      "Denied",
      "Epigastric",
      "Right upper quadrant",
      "Right lower quadrant",
      "Suprapubic",
      "Generalised",
      "Other site",
    ],
  },
  {
    key: "bowel",
    label: "Bowel symptoms",
    options: [
      "Not asked",
      "No change",
      "Diarrhoea",
      "Constipation",
      "Blood in stool",
      "Melaena",
    ],
  },
  {
    key: "urinary",
    label: "Urinary symptoms",
    options: [
      "Not asked",
      "Denied",
      "Dysuria",
      "Frequency / urgency",
      "Haematuria",
      "Reduced urine output",
      "Incontinence",
    ],
  },
  {
    key: "headache",
    label: "Headache",
    options: [
      "Not asked",
      "Denied",
      "Acute sudden onset",
      "Progressive",
      "Recurrent",
      "With visual symptoms",
      "With neck stiffness",
    ],
  },
  {
    key: "neurological",
    label: "Neurological symptoms",
    options: [
      "Not asked",
      "Denied",
      "Seizure",
      "Syncope",
      "Focal weakness",
      "Sensory change",
      "Speech disturbance",
      "Confusion",
    ],
  },
  {
    key: "joint",
    label: "Joint symptoms",
    options: [
      "Not asked",
      "Denied",
      "Pain only",
      "Swelling",
      "Morning stiffness",
      "Reduced function",
    ],
  },
  {
    key: "skin",
    label: "Skin symptoms",
    options: [
      "Not asked",
      "Denied",
      "Rash",
      "Pruritus",
      "Ulcer / wound",
      "Petechiae / purpura",
    ],
  },
  {
    key: "polyuria",
    label: "Diabetes symptoms",
    options: [
      "Not asked",
      "Denied",
      "Polyuria",
      "Polydipsia",
      "Polyphagia",
      "Hypoglycaemic symptoms",
      "Foot symptoms",
    ],
  },
  {
    key: "anc_bleeding",
    label: "Vaginal bleeding",
    options: [
      "Not asked",
      "Denied",
      "Spotting",
      "Light bleeding",
      "Heavy bleeding",
    ],
  },
  {
    key: "anc_fluid",
    label: "Fluid loss",
    options: [
      "Not asked",
      "Denied",
      "Suspected leakage of liquor",
      "Confirmed / continuous leakage",
    ],
  },
  {
    key: "anc_movement",
    label: "Fetal movement",
    options: [
      "Not applicable / not asked",
      "Normal for gestation",
      "Reduced",
      "Absent",
    ],
  },
  {
    key: "anc_preeclampsia",
    label: "Pre-eclampsia warning symptoms",
    options: [
      "Not asked",
      "Denied",
      "Severe headache",
      "Visual disturbance",
      "Epigastric / RUQ pain",
      "Sudden face / hand swelling",
    ],
  },
  {
    key: "child_feeding",
    label: "Feeding / drinking",
    options: [
      "Not asked",
      "Feeding normally",
      "Feeding less",
      "Not able to drink / breastfeed",
    ],
  },
  {
    key: "child_activity",
    label: "Child’s activity",
    options: [
      "Not asked",
      "Alert / usual activity",
      "Restless / irritable",
      "Lethargic",
      "Unconscious",
    ],
  },
];
const reviewKeysByClinic: Record<string, string[]> = {
  ANC: [
    "anc_bleeding",
    "anc_fluid",
    "anc_movement",
    "anc_preeclampsia",
    "fever",
    "urinary",
    "vomiting",
  ],
  HTN: [
    "headache",
    "chest_pain",
    "dyspnoea",
    "palpitations",
    "neurological",
    "oedema_symptom",
    "urinary",
  ],
  DM: [
    "polyuria",
    "weight",
    "neurological",
    "skin",
    "chest_pain",
    "dyspnoea",
    "urinary",
  ],
  Paediatrics: [
    "child_feeding",
    "child_activity",
    "fever",
    "cough",
    "dyspnoea",
    "wheeze",
    "vomiting",
    "bowel",
    "skin",
    "neurological",
  ],
  Emergency: [
    "fever",
    "dyspnoea",
    "chest_pain",
    "palpitations",
    "vomiting",
    "abdominal_pain",
    "headache",
    "neurological",
    "urinary",
  ],
  Outpatient: [
    "fever",
    "weight",
    "cough",
    "dyspnoea",
    "chest_pain",
    "vomiting",
    "abdominal_pain",
    "bowel",
    "urinary",
    "headache",
    "neurological",
    "joint",
    "skin",
  ],
};
function reviewFindingsForClinic(clinic: string) {
  const keys = reviewKeysByClinic[clinic] || reviewKeysByClinic.Outpatient;
  return reviewSystems.filter((item) => keys.includes(item.key));
}
const generalFindings: FindingDefinition[] = [
  {
    key: "appearance",
    label: "General appearance",
    options: [
      "Not assessed",
      "Well appearing",
      "Acutely ill appearing",
      "Chronically ill appearing",
      "Distressed",
      "Toxic appearing",
    ],
  },
  {
    key: "hydration",
    label: "Hydration",
    options: [
      "Not assessed",
      "Clinically hydrated",
      "Mild dehydration suspected",
      "Moderate dehydration suspected",
      "Severe dehydration suspected",
    ],
  },
  {
    key: "pallor",
    label: "Pallor",
    options: ["Not assessed", "Absent", "Mild", "Moderate", "Severe"],
  },
  {
    key: "pallor_site",
    label: "Pallor assessment site",
    options: [
      "Not recorded",
      "Conjunctival",
      "Palmar",
      "Nail bed",
      "Generalised",
    ],
  },
  {
    key: "jaundice",
    label: "Jaundice",
    options: [
      "Not assessed",
      "Absent",
      "Scleral icterus",
      "Generalised jaundice",
    ],
  },
  {
    key: "cyanosis",
    label: "Cyanosis",
    options: [
      "Not assessed",
      "Absent",
      "Central",
      "Peripheral",
      "Central and peripheral",
    ],
  },
  {
    key: "oedema",
    label: "Pitting oedema grade",
    options: ["Not assessed", "Absent", "1+", "2+", "3+", "4+", "Non-pitting"],
  },
  {
    key: "oedema_distribution",
    label: "Oedema distribution",
    options: [
      "Not applicable",
      "Unilateral lower limb",
      "Bilateral ankles",
      "Bilateral to knees",
      "Sacral",
      "Periorbital",
      "Generalised",
    ],
  },
  {
    key: "lymph_nodes",
    label: "Lymph nodes",
    options: [
      "Not examined",
      "No palpable lymphadenopathy",
      "Localised lymphadenopathy",
      "Generalised lymphadenopathy",
    ],
  },
];
const examinationGroups: { title: string; findings: FindingDefinition[] }[] = [
  {
    title: "Respiratory",
    findings: [
      {
        key: "resp_effort",
        label: "Respiratory effort",
        options: [
          "Not examined",
          "Unlaboured",
          "Accessory muscle use",
          "Intercostal recession",
          "Subcostal recession",
          "Paradoxical breathing",
        ],
      },
      {
        key: "resp_expansion",
        label: "Chest expansion",
        options: [
          "Not examined",
          "Symmetrical",
          "Reduced bilaterally",
          "Reduced on right",
          "Reduced on left",
        ],
      },
      {
        key: "resp_percussion",
        label: "Percussion note",
        options: [
          "Not examined",
          "Resonant bilaterally",
          "Dull",
          "Stony dull",
          "Hyperresonant",
        ],
      },
      {
        key: "resp_breath_sounds",
        label: "Breath sounds",
        options: [
          "Not examined",
          "Vesicular bilaterally",
          "Reduced air entry",
          "Bronchial breathing",
          "Absent",
        ],
      },
      {
        key: "resp_added_sounds",
        label: "Added sounds",
        options: [
          "Not examined",
          "None",
          "Wheeze",
          "Crackles — early inspiratory",
          "Crackles — late inspiratory",
          "Crackles — pan-inspiratory",
          "Pleural rub",
          "Stridor",
        ],
      },
    ],
  },
  {
    title: "Cardiovascular",
    findings: [
      {
        key: "cvs_pulse_rhythm",
        label: "Pulse rhythm",
        options: [
          "Not examined",
          "Regular",
          "Regularly irregular",
          "Irregularly irregular",
        ],
      },
      {
        key: "cvs_pulse_volume",
        label: "Pulse volume",
        options: ["Not examined", "Normal volume", "Low volume", "Bounding"],
      },
      {
        key: "cvs_jvp",
        label: "JVP",
        options: ["Not examined", "Not elevated", "Elevated"],
      },
      {
        key: "cvs_heart_sounds",
        label: "Heart sounds",
        options: [
          "Not examined",
          "S1 and S2 present",
          "Additional heart sound",
          "Heart sounds diminished",
        ],
      },
      {
        key: "cvs_murmur",
        label: "Murmur",
        options: [
          "Not examined",
          "No murmur heard",
          "Systolic murmur",
          "Diastolic murmur",
          "Continuous murmur",
        ],
      },
      {
        key: "cvs_perfusion",
        label: "Peripheral perfusion",
        options: [
          "Not examined",
          "Warm; capillary refill ≤2 s",
          "Cool peripheries",
          "Capillary refill >2 s",
        ],
      },
    ],
  },
  {
    title: "Abdominal",
    findings: [
      {
        key: "abd_contour",
        label: "Contour",
        options: ["Not examined", "Flat", "Scaphoid", "Distended"],
      },
      {
        key: "abd_tenderness",
        label: "Tenderness",
        options: [
          "Not examined",
          "Non-tender",
          "Localised tenderness",
          "Generalised tenderness",
        ],
      },
      {
        key: "abd_guarding",
        label: "Guarding / rebound",
        options: [
          "Not examined",
          "Absent",
          "Voluntary guarding",
          "Involuntary guarding",
          "Rebound tenderness",
          "Rigidity",
        ],
      },
      {
        key: "abd_masses",
        label: "Masses",
        options: ["Not examined", "No mass palpable", "Mass palpable"],
      },
      {
        key: "abd_organs",
        label: "Liver / spleen",
        options: [
          "Not examined",
          "Not palpably enlarged",
          "Hepatomegaly",
          "Splenomegaly",
          "Hepatosplenomegaly",
        ],
      },
      {
        key: "abd_bowel",
        label: "Bowel sounds",
        options: [
          "Not auscultated",
          "Present",
          "Hyperactive",
          "Reduced",
          "Absent",
        ],
      },
      {
        key: "abd_ascites",
        label: "Ascites",
        options: [
          "Not assessed",
          "No clinical ascites",
          "Shifting dullness present",
          "Fluid thrill present",
        ],
      },
    ],
  },
  {
    title: "Neurological",
    findings: [
      {
        key: "neuro_mental",
        label: "Mental status",
        options: [
          "Not examined",
          "Alert and oriented",
          "Confused",
          "Drowsy",
          "Obtunded",
          "Unresponsive",
        ],
      },
      {
        key: "neuro_cranial",
        label: "Cranial nerves",
        options: ["Not examined", "No gross deficit", "Deficit identified"],
      },
      {
        key: "neuro_tone",
        label: "Muscle tone",
        options: [
          "Not examined",
          "Normal",
          "Hypotonia",
          "Spasticity",
          "Rigidity",
          "Flaccidity",
        ],
      },
      {
        key: "neuro_power",
        label: "Lowest MRC muscle power",
        options: ["Not examined", "5/5", "4/5", "3/5", "2/5", "1/5", "0/5"],
      },
      {
        key: "neuro_reflexes",
        label: "Deep tendon reflexes",
        options: [
          "Not examined",
          "0 absent",
          "1+ reduced",
          "2+ average",
          "3+ brisk",
          "4+ clonus",
        ],
      },
      {
        key: "neuro_sensation",
        label: "Sensation",
        options: [
          "Not examined",
          "Intact to tested modalities",
          "Reduced",
          "Absent",
          "Asymmetrical",
        ],
      },
      {
        key: "neuro_gait",
        label: "Gait",
        options: [
          "Not examined",
          "Normal",
          "Antalgic",
          "Ataxic",
          "Hemiplegic",
          "Parkinsonian",
          "Unable to walk",
        ],
      },
    ],
  },
  {
    title: "Musculoskeletal",
    findings: [
      {
        key: "msk_joint",
        label: "Joint findings",
        options: [
          "Not examined",
          "No swelling or tenderness",
          "Tenderness",
          "Swelling",
          "Warmth",
          "Deformity",
        ],
      },
      {
        key: "msk_rom",
        label: "Range of movement",
        options: [
          "Not examined",
          "Full active and passive",
          "Reduced active",
          "Reduced passive",
          "Reduced active and passive",
        ],
      },
    ],
  },
  {
    title: "ENT and skin",
    findings: [
      {
        key: "ent_ears",
        label: "Ear examination",
        options: [
          "Not examined",
          "Canals and tympanic membranes unremarkable",
          "Canal finding",
          "Tympanic membrane finding",
          "Discharge",
        ],
      },
      {
        key: "ent_throat",
        label: "Oropharynx",
        options: [
          "Not examined",
          "No visible abnormality",
          "Erythema",
          "Tonsillar enlargement",
          "Exudate",
          "Oral lesion",
        ],
      },
      {
        key: "skin",
        label: "Skin",
        options: [
          "Not examined",
          "No visible lesion",
          "Rash",
          "Ulcer",
          "Wound",
          "Petechiae / purpura",
          "Other lesion",
        ],
      },
    ],
  },
];
const examinationSystems = examinationGroups.flatMap((group) => group.findings);
const examinationOrderByClinic: Record<string, string[]> = {
  ANC: ["Abdominal", "Cardiovascular"],
  HTN: ["Cardiovascular", "Neurological"],
  DM: ["Neurological", "ENT and skin", "Cardiovascular"],
  Paediatrics: ["Respiratory", "Abdominal", "Neurological", "ENT and skin"],
  Emergency: ["Respiratory", "Cardiovascular", "Neurological", "Abdominal"],
};
function examinationGroupsForClinic(clinic: string) {
  const order = examinationOrderByClinic[clinic] || [];
  return [...examinationGroups].sort((a, b) => {
    const ai = order.indexOf(a.title);
    const bi = order.indexOf(b.title);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

function serializeFindings(
  form: FormData,
  prefix: string,
  systems: readonly FindingDefinition[],
  notesField: string,
) {
  const findings = systems.map(
    ({ key, label }) =>
      `${label}: ${form.get(`${prefix}_${key}`) || "Not recorded"}`,
  );
  const notes = String(form.get(notesField) || "").trim();
  return [
    ...findings,
    ...(notes ? [`Additional findings: ${notes}`] : []),
  ].join("\n");
}

export default function ConsultationWorkstation({
  visits,
  onCompleted,
  onOpenServicePoints,
  initialVisitId,
  onInitialVisitOpened,
}: {
  visits: Visit[];
  onCompleted: (patientName: string) => void;
  onOpenServicePoints?: (visitId: string) => void;
  initialVisitId?: string | null;
  onInitialVisitOpened?: () => void;
}) {
  const [active, setActive] = useState<Visit | null>(null);
  useEffect(() => {
    if (!initialVisitId) return;
    const visit = visits.find((item) => item.id === initialVisitId);
    if (visit) {
      setActive(visit);
      onInitialVisitOpened?.();
    }
  }, [initialVisitId, visits, onInitialVisitOpened]);
  if (!active)
    return (
      <>
        <header>
          <div>
            <p className="eyebrow">Consultation room</p>
            <h1>Awaiting clinician</h1>
            <p>Select a triaged patient to open the private clinical record.</p>
          </div>
        </header>
        <section className="card">
          {visits.length === 0 ? (
            <div className="empty">
              <strong>No patients awaiting consultation</strong>
              <p>Patients appear here after completed triage.</p>
            </div>
          ) : (
            <div className="queue">
              {visits.map((visit) => (
                <button
                  className={`row ${visit.priority.toLowerCase()}`}
                  key={visit.id}
                  onClick={() => setActive(visit)}
                >
                  <span className="dot" />
                  <div>
                    <strong>{visit.patient.fullName}</strong>
                    <small>
                      {visit.patient.patientNumber} ·{" "}
                      {patientClinicalGroup(visit.patient).label} ·{" "}
                      {visit.clinic}
                    </small>
                  </div>
                  <b>{visit.priority}</b>
                  <time>{visit.visitNumber}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      </>
    );
  return (
    <ConsultationForm
      visit={active}
      onBack={() => setActive(null)}
      onCompleted={onCompleted}
      onOpenServicePoints={onOpenServicePoints}
    />
  );
}

function ConsultationForm({
  visit,
  onBack,
  onCompleted,
  onOpenServicePoints,
}: {
  visit: Visit;
  onBack: () => void;
  onCompleted: (name: string) => void;
  onOpenServicePoints?: (visitId: string) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [medicine, setMedicine] = useState("");
  const [doseQuantity, setDoseQuantity] = useState(1);
  const [frequencyPerDay, setFrequencyPerDay] = useState(1);
  const [durationDays, setDurationDays] = useState(1);
  const [dispenseQuantity, setDispenseQuantity] = useState(1);
  const [prescriptionKey, setPrescriptionKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [savingPrescription, setSavingPrescription] = useState(false);
  const [duplicateConflict, setDuplicateConflict] =
    useState<DuplicateConflict | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogItem[]>([]);
  const [diagnosisQuery, setDiagnosisQuery] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosisUri, setDiagnosisUri] = useState("");
  const [diagnosisResults, setDiagnosisResults] = useState<
    DiagnosisSearchResult[]
  >([]);
  const [diagnosisSearching, setDiagnosisSearching] = useState(false);
  const [diagnosisSourceWarning, setDiagnosisSourceWarning] = useState("");
  const [activeStep, setActiveStep] = useState(1);
  const draft =
    visit.encounters?.find((item) => item.status === "DRAFT") ||
    visit.encounters?.[0];
  const savedSubjective = parseRecord(draft?.subjective);
  const savedObjective = parseRecord(draft?.objective);
  const savedPlan = parseRecord(draft?.plan);
  const [savedDiagnoses, setSavedDiagnoses] = useState(draft?.diagnoses || []);
  const [history, setHistory] = useState<HistoryVisit[]>([]);
  useEffect(
    () =>
      setDispenseQuantity(
        calculateDispenseQuantity(doseQuantity, frequencyPerDay, durationDays),
      ),
    [doseQuantity, frequencyPerDay, durationDays],
  );
  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => response.json())
      .then((data) =>
        setCatalogue(
          (data.items || []).filter((item: CatalogItem) => item.active),
        ),
      )
      .catch(() => setError("The order catalogue could not be loaded"));
  }, []);
  useEffect(() => {
    jsonRequest<{ visits: HistoryVisit[] }>(
      `/api/patients/${visit.patient.id}/history?exclude=${visit.id}`,
      undefined,
      "Previous clinical history could not be loaded",
    )
      .then((result) => setHistory(result.visits))
      .catch((reason) => setError((reason as Error).message));
  }, [visit.id, visit.patient.id]);
  useEffect(() => {
    if (diagnosisQuery.trim().length < 2 || diagnosisCode)
      return setDiagnosisResults([]);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDiagnosisSearching(true);
      try {
        const response = await fetch(
          `/api/diagnoses/search?q=${encodeURIComponent(diagnosisQuery)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (response.ok) {
          setDiagnosisResults(data.results || []);
          setDiagnosisSourceWarning(
            data.configurationRequired
              ? "WHO ICD-11 live search needs API credentials. Only diagnoses previously used at this facility are currently shown."
              : "",
          );
        }
      } finally {
        setDiagnosisSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [diagnosisQuery, diagnosisCode]);
  const focusedReview = reviewFindingsForClinic(visit.clinic);
  const focusedExaminations = examinationGroupsForClinic(visit.clinic);
  const observation = (code: string) => {
    const item = visit.triage?.observations.find(
      (value) => value.code === code,
    );
    return (
      item?.valueText ||
      (item?.valueDecimal
        ? `${Number(item.valueDecimal)}${item.unit ? ` ${item.unit}` : ""}`
        : "—")
    );
  };
  async function run(action: string, data: unknown, message: string) {
    setError("");
    setNotice("");
    try {
      const result = await post(`/api/visits/${visit.id}/consultation`, {
        action,
        data,
      });
      setNotice(
        result.warnings?.length
          ? `${message} ${result.warnings.join(" ")}`
          : message,
      );
      return result;
    } catch (e) {
      const details = (e as Error & { details?: DuplicateConflict }).details;
      if (
        details?.code === "EXACT_DUPLICATE" ||
        details?.code === "SAME_VISIT_DUPLICATE"
      )
        setDuplicateConflict(details);
      setError((e as Error).message);
      return false;
    }
  }
  function notes(f: FormData) {
    return {
      chiefComplaint: f.get("chiefComplaint"),
      historyPresentingIllness: f.get("historyPresentingIllness"),
      symptomDuration: f.get("symptomDuration") || undefined,
      reviewOfSystems: serializeFindings(
        f,
        "ros",
        focusedReview,
        "reviewNotes",
      ),
      pastMedicalHistory: f.get("pastMedicalHistory") || undefined,
      currentMedicines: f.get("currentMedicines") || undefined,
      familySocialHistory: f.get("familySocialHistory") || undefined,
      generalExamination: serializeFindings(
        f,
        "general",
        generalFindings,
        "generalExamNotes",
      ),
      systemicExamination: serializeFindings(
        f,
        "exam",
        examinationSystems,
        "systemExamNotes",
      ),
      plan: f.get("plan"),
      confidentialNote: f.get("confidentialNote") || undefined,
      followUpDate: f.get("followUpDate") || undefined,
      disposition: f.get("disposition"),
    };
  }
  async function act(
    event: React.MouseEvent<HTMLButtonElement>,
    action:
      | "SAVE_NOTES"
      | "SAVE_DIAGNOSIS"
      | "SUBMIT_INVESTIGATIONS"
      | "SAVE_PRESCRIPTION"
      | "SIGN",
    submitPrescription = false,
  ) {
    const form = event.currentTarget.form!;
    const f = new FormData(form);
    if (action === "SAVE_NOTES")
      return run(action, notes(f), "Clinical notes saved as a draft.");
    if (action === "SAVE_DIAGNOSIS") {
      const result = await run(
        action,
        {
          code: f.get("primaryIcd11"),
          title: f.get("primaryDiagnosis"),
          foundationUri: f.get("foundationUri") || undefined,
          type: f.get("diagnosisType"),
          primary: f.get("diagnosisRole") === "PRIMARY",
        },
        "Primary ICD-11 diagnosis recorded.",
      );
      if (result && result.diagnosis) {
        setSavedDiagnoses((current) => [
          ...current.map((item) =>
            result.diagnosis.primary ? { ...item, primary: false } : item,
          ),
          result.diagnosis,
        ]);
        setDiagnosisQuery("");
        setDiagnosisCode("");
        setDiagnosisUri("");
      }
      return result;
    }
    if (action === "SUBMIT_INVESTIGATIONS")
      return run(
        action,
        {
          labs: f.getAll("labs"),
          imaging: f.getAll("imaging"),
          priority: f.get("investigationPriority"),
          indication: f.get("investigationIndication"),
        },
        "Investigation requests submitted and billing updated.",
      );
    if (action === "SAVE_PRESCRIPTION") {
      if (savingPrescription) return false;
      setSavingPrescription(true);
      const prescriptions = medicine
        ? [
            {
              medicineCode: medicine,
              indication: f.get("medicineIndication"),
              dose: f.get("dose"),
              doseQuantity,
              route: f.get("route"),
              frequency: f.get("frequency"),
              frequencyPerDay,
              duration: f.get("duration") || undefined,
              durationDays,
              startDate: f.get("startDate"),
              stopDate: f.get("stopDate") || undefined,
              quantity: f.get("quantity"),
              quantityConfirmed: f.get("quantityConfirmed") === "on",
              instructions: f.get("medicineInstructions"),
              doseTiming: f.get("doseTiming"),
              sequenceNote: f.get("sequenceNote") || undefined,
            },
          ]
        : [];
      try {
        const result = await run(
          action,
          {
            submit: submitPrescription,
            idempotencyKey: prescriptionKey,
            duplicateAction: f.get("duplicateAction") || undefined,
            duplicateReason: f.get("duplicateReason") || undefined,
            prescriptions,
          },
          submitPrescription
            ? "Prescription signed and sent to pharmacy. Billing will use the confirmed supplied quantity."
            : "Prescription saved as a draft; it has not been billed.",
        );
        if (result) {
          setPrescriptionKey(crypto.randomUUID());
          setDuplicateConflict(null);
        }
        return result;
      } finally {
        setSavingPrescription(false);
      }
    }
    if (
      await run(
        action,
        { disposition: f.get("disposition") },
        "Consultation signed.",
      )
    )
      onCompleted(visit.patient.fullName);
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Private consultation</p>
          <h1>{visit.patient.fullName}</h1>
          <p>
            {visit.patient.patientNumber} ·{" "}
            {patientClinicalGroup(visit.patient).label} · {visit.visitNumber}
          </p>
        </div>
        <button className="secondary" onClick={onBack}>
          ← Back to queue
        </button>
      </header>
      <section className="clinicalSummary">
        <div>
          <small>Clinic</small>
          <strong>{visit.clinic}</strong>
        </div>
        <div>
          <small>Triage</small>
          <strong>{visit.triage?.triageCategory || visit.priority}</strong>
        </div>
        <div>
          <small>BP</small>
          <strong>
            {observation("BP_SYS")}/{observation("BP_DIA")}
          </strong>
        </div>
        <div>
          <small>Pulse</small>
          <strong>{observation("PULSE")}</strong>
        </div>
        <div>
          <small>SpO₂</small>
          <strong>{observation("SPO2")}</strong>
        </div>
        <div>
          <small>Temperature</small>
          <strong>{observation("TEMP")}</strong>
        </div>
      </section>
      {visit.patient.allergies?.length ? (
        <div className="allergyAlert">
          <strong>Allergy alert</strong>
          {visit.patient.allergies.map((a) => (
            <span key={a.substance}>
              {a.substance}
              {a.reaction ? ` — ${a.reaction}` : ""}
            </span>
          ))}
        </div>
      ) : (
        <div className="noAllergy">
          No active allergies recorded — verify with the patient.
        </div>
      )}
      <details className="card historyPanel">
        <summary>
          <strong>Recent clinical history</strong>
          <span>
            {history.length
              ? `${history.length} previous visit${history.length === 1 ? "" : "s"}`
              : "No previous visits found"}
          </span>
        </summary>
        {history.map((previous) => (
          <article key={previous.id}>
            <h3>
              {new Date(previous.arrivedAt).toLocaleDateString()} ·{" "}
              {previous.clinic}
            </h3>
            <p>
              <strong>Diagnosis:</strong>{" "}
              {previous.encounters[0]?.diagnoses
                .map((item) => `${item.code || ""} ${item.description}`.trim())
                .join(" · ") || "No signed diagnosis"}
            </p>
            <p>
              <strong>Medicines:</strong>{" "}
              {previous.orders
                .filter((item) => item.prescription)
                .map(
                  (item) =>
                    `${item.prescription!.genericName || item.displayName}${item.prescription!.strength ? ` ${item.prescription!.strength}` : ""} — ${item.prescription!.dose}, ${item.prescription!.frequency}`,
                )
                .join(" · ") || "None recorded"}
            </p>
            <p>
              <strong>Results:</strong>{" "}
              {previous.orders
                .flatMap((item) => item.laboratory?.result?.items || [])
                .map(
                  (item) =>
                    `${item.analyte} ${item.value}${item.unit ? ` ${item.unit}` : ""}${item.flag ? ` (${item.flag})` : ""}`,
                )
                .join(" · ") ||
                previous.orders
                  .map((item) => item.imaging?.result?.conclusion)
                  .filter(Boolean)
                  .join(" · ") ||
                "No verified results"}
            </p>
          </article>
        ))}
      </details>
      <form
        className="consultForm"
        onSubmit={(event) => event.preventDefault()}
      >
        {error && <div className="alert">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}
        <nav className="consultNavigator" aria-label="Consultation sections">
          {[
            [1, "History"],
            [2, "Background"],
            [3, "Examination"],
            [4, "Diagnosis"],
            [5, "Investigations"],
            [6, "Prescription"],
            [7, "Plan & sign"],
          ].map(([step, label]) => (
            <button
              type="button"
              className={activeStep === step ? "active" : ""}
              onClick={() => setActiveStep(Number(step))}
              key={step}
            >
              <b>{step}</b>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <ClinicalSection
          number="1"
          title="Presenting complaint & history"
          description="Document privately in the patient’s own words."
          active={activeStep === 1}
          onOpen={() => setActiveStep(1)}
        >
          <label>
            Chief complaint *
            <textarea
              name="chiefComplaint"
              required
              minLength={2}
              rows={2}
              defaultValue={savedSubjective.chiefComplaint || ""}
            />
          </label>
          <label>
            Duration
            <input
              name="symptomDuration"
              placeholder="e.g. 3 days"
              defaultValue={savedSubjective.symptomDuration || ""}
            />
          </label>
          <label className="span2">
            History of presenting illness *
            <textarea
              name="historyPresentingIllness"
              required
              minLength={2}
              rows={5}
              defaultValue={savedSubjective.historyPresentingIllness || ""}
            />
          </label>
          <details className="span2 findingsBlock progressiveDetails">
            <summary>
              <span>
                <strong>Focused review of systems</strong>
                <small>
                  {focusedReview.length} prompts selected for {visit.clinic};
                  open when clinically relevant
                </small>
              </span>
            </summary>
            <FindingsGrid
              prefix="ros"
              findings={focusedReview}
              values={parseFindings(savedSubjective.reviewOfSystems)}
            />
            <label>
              Relevant review notes
              <textarea
                name="reviewNotes"
                rows={3}
                defaultValue={
                  parseFindings(savedSubjective.reviewOfSystems)[
                    "Additional findings"
                  ] || ""
                }
              />
            </label>
          </details>
          <div className="span2 sectionAdvance">
            <span>Keep documentation concise and problem-oriented.</span>
            <button
              type="button"
              className="primary"
              onClick={() => setActiveStep(2)}
            >
              Background →
            </button>
          </div>
        </ClinicalSection>
        <ClinicalSection
          number="2"
          title="Background history"
          description="Capture information relevant to today’s decisions."
          active={activeStep === 2}
          onOpen={() => setActiveStep(2)}
        >
          <label>
            Past medical and surgical history
            <textarea
              name="pastMedicalHistory"
              rows={3}
              defaultValue={savedSubjective.pastMedicalHistory || ""}
            />
          </label>
          <label>
            Current medicines
            <textarea
              name="currentMedicines"
              rows={3}
              defaultValue={savedSubjective.currentMedicines || ""}
            />
          </label>
          <label className="span2">
            Family and social history
            <textarea
              name="familySocialHistory"
              rows={3}
              defaultValue={savedSubjective.familySocialHistory || ""}
            />
          </label>
          <div className="span2 sectionAdvance">
            <button
              type="button"
              className="secondary"
              onClick={() => setActiveStep(1)}
            >
              ← History
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setActiveStep(3)}
            >
              Examination →
            </button>
          </div>
        </ClinicalSection>
        <ClinicalSection
          number="3"
          title="Examination"
          description="Triage observations remain visible above."
          active={activeStep === 3}
          onOpen={() => setActiveStep(3)}
        >
          <details className="span2 findingsBlock progressiveDetails" open>
            <summary>
              <span>
                <strong>General examination</strong>
                <small>Core examination findings</small>
              </span>
            </summary>
            <FindingsGrid
              prefix="general"
              findings={generalFindings}
              values={parseFindings(savedObjective.generalExamination)}
            />
            <label>
              General examination notes
              <textarea
                name="generalExamNotes"
                rows={3}
                defaultValue={
                  parseFindings(savedObjective.generalExamination)[
                    "Additional findings"
                  ] || ""
                }
              />
            </label>
          </details>
          <div className="span2 findingsBlock">
            <h3>System examination</h3>
            <p>
              Use the examination-specific vocabulary below and localize
              significant findings in the notes.
            </p>
            {focusedExaminations.map((group, index) => (
              <details
                className="examGroup"
                key={group.title}
                open={index === 0}
              >
                <summary>
                  {group.title}
                  <span>Open focused examination</span>
                </summary>
                <FindingsGrid
                  prefix="exam"
                  findings={group.findings}
                  values={parseFindings(savedObjective.systemicExamination)}
                />
              </details>
            ))}
            <label>
              Abnormal findings / additional examination notes
              <textarea
                name="systemExamNotes"
                rows={4}
                defaultValue={
                  parseFindings(savedObjective.systemicExamination)[
                    "Additional findings"
                  ] || ""
                }
              />
            </label>
          </div>
        </ClinicalSection>
        <div className={`stepAction ${activeStep === 3 ? "" : "stepHidden"}`}>
          <div>
            <strong>Clinical note draft</strong>
            <span>
              Save your history and examination without signing the encounter.
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={async (event) => {
              if (await act(event, "SAVE_NOTES")) setActiveStep(4);
            }}
          >
            Save clinical notes
          </button>
        </div>
        <ClinicalSection
          number="4"
          title="ICD-11 assessment"
          description="Record the diagnosis using the WHO ICD-11 MMS coding system."
          active={activeStep === 4}
          onOpen={() => setActiveStep(4)}
        >
          {savedDiagnoses.length > 0 && (
            <div className="span2 diagnosisList">
              <strong>Recorded diagnoses</strong>
              {savedDiagnoses.map((item, index) => (
                <div key={item.id || `${item.code}-${index}`}>
                  <span>
                    {item.primary ? "PRIMARY" : item.type || "SECONDARY"}
                  </span>
                  <b>
                    {item.code} · {item.description}
                  </b>
                </div>
              ))}
            </div>
          )}
          <div className="span2 diagnosisSearch">
            <label>
              Search diagnosis or ICD-11 code *
              <input
                name="primaryDiagnosis"
                value={diagnosisQuery}
                onChange={(e) => {
                  setDiagnosisQuery(e.target.value);
                  setDiagnosisCode("");
                  setDiagnosisUri("");
                }}
                required
                minLength={2}
                autoComplete="off"
                placeholder="Type a condition, symptom or ICD-11 code"
              />
            </label>
            {diagnosisSearching && <small>Searching diagnoses…</small>}
            {diagnosisResults.length > 0 && (
              <div className="diagnosisResults" role="listbox">
                {diagnosisResults.map((result) => (
                  <button
                    type="button"
                    key={`${result.code}-${result.title}`}
                    onClick={() => {
                      setDiagnosisQuery(result.title);
                      setDiagnosisCode(result.code);
                      setDiagnosisUri(result.foundationUri || "");
                      setDiagnosisResults([]);
                    }}
                  >
                    <strong>{result.title}</strong>
                    <span>
                      {result.code} · {result.source}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            ICD-11 MMS code *
            <input
              name="primaryIcd11"
              required
              value={diagnosisCode}
              onChange={(e) => setDiagnosisCode(e.target.value.toUpperCase())}
              placeholder="Selected automatically"
              autoCapitalize="characters"
            />
          </label>
          <input type="hidden" name="foundationUri" value={diagnosisUri} />
          <label>
            Diagnostic certainty
            <select name="diagnosisType">
              <option value="PROVISIONAL">Provisional</option>
              <option value="DIFFERENTIAL">Differential</option>
              <option value="FINAL">Confirmed / final</option>
            </select>
          </label>
          <label>
            Diagnosis role
            <select name="diagnosisRole">
              <option value="PRIMARY">Primary diagnosis</option>
              <option value="SECONDARY">Secondary / comorbidity</option>
            </select>
          </label>
          <div className="span2 privacyNotice">
            <strong>ICD-11 coding</strong>
            <span>
              Search by familiar clinical wording, then select the matching
              ICD-11 MMS diagnosis. Confirm the displayed title and code before
              saving.
            </span>
            {diagnosisSourceWarning && (
              <span className="dangerText">{diagnosisSourceWarning}</span>
            )}
            <a
              href="https://icd.who.int/browse/2026-01/mms/en"
              target="_blank"
              rel="noreferrer"
            >
              Open the official WHO ICD-11 browser ↗
            </a>
          </div>
          <button
            type="button"
            className="secondary span2"
            onClick={async (event) => {
              if (await act(event, "SAVE_DIAGNOSIS")) setActiveStep(5);
            }}
          >
            Add ICD-11 diagnosis
          </button>
        </ClinicalSection>
        <ClinicalSection
          number="5"
          title="Investigations"
          description="Selected items route automatically and are added to billing."
          active={activeStep === 5}
          onOpen={() => setActiveStep(5)}
        >
          <label>
            Priority *
            <select name="investigationPriority" defaultValue={visit.priority}>
              <option value="ROUTINE">Routine</option>
              <option value="PRIORITY">Priority</option>
              <option value="URGENT">Urgent</option>
              <option value="EMERGENCY">Emergency</option>
            </select>
          </label>
          <label>
            Clinical indication *
            <input
              name="investigationIndication"
              required
              defaultValue={
                savedDiagnoses.find((item) => item.primary)?.description || ""
              }
              placeholder="Why the investigation is needed"
            />
          </label>
          <SearchableMultiPicker
            name="labs"
            label="Laboratory tests"
            options={catalogue
              .filter((item) => item.category === "LABORATORY_TEST")
              .map((item) => ({
                value: item.code,
                label: item.name,
                detail: `KES ${Number(item.unitPrice).toLocaleString()}`,
              }))}
          />
          <div className="span2 submitBar">
            <span>
              Submission creates service requests and adds their charges to the
              invoice.
            </span>
            <button
              type="button"
              className="primary"
              onClick={(event) => act(event, "SUBMIT_INVESTIGATIONS")}
            >
              Submit investigation requests
            </button>
          </div>
          <SearchableMultiPicker
            name="imaging"
            label="Imaging and procedures"
            options={catalogue
              .filter((item) => item.category === "PROCEDURE")
              .map((item) => ({
                value: item.code,
                label: item.name,
                detail: `KES ${Number(item.unitPrice).toLocaleString()}`,
              }))}
          />
        </ClinicalSection>
        <ClinicalSection
          number="6"
          title="Prescription"
          description="Prescribe only after checking allergies, indication, dose and patient factors."
          active={activeStep === 6}
          onOpen={() => setActiveStep(6)}
        >
          {visit.orders?.some(order => order.type === "MEDICATION" && order.prescription && !["COMPLETED", "CANCELLED"].includes(order.status)) && <div className="span2 currentOrders"><strong>Current prescriptions</strong>{visit.orders.filter(order => order.type === "MEDICATION" && order.prescription && !["COMPLETED", "CANCELLED"].includes(order.status)).map(order => <div className="summaryLine" key={order.id}><span><b>{order.displayName}</b> · {order.prescription!.dose} · {order.prescription!.route} · {order.prescription!.frequency} · {order.prescription!.duration || "duration pending"} · Qty {Number(order.prescription!.quantity)}</span><button type="button" className="secondary" onClick={() => { const prescription = order.prescription!; setMedicine(prescription.medicineCode); setDuplicateConflict({ code: "SAME_VISIT_DUPLICATE", existingOrderId: order.id, existingPrescriptionId: prescription.id || "", existing: { genericName: prescription.genericName || order.displayName, strength: prescription.strength, dosageForm: prescription.dosageForm, dose: prescription.dose, route: prescription.route, frequency: prescription.frequency, duration: prescription.duration, quantity: prescription.quantity, instructions: prescription.instructions } }); }}>Correct</button></div>)}</div>}
          <label className="span2">
            Medicine
            <SearchablePicker
              value={medicine}
              onChange={(value) => {
                setMedicine(value);
                setDoseQuantity(1);
                setFrequencyPerDay(1);
                setDurationDays(1);
                setPrescriptionKey(crypto.randomUUID());
                setDuplicateConflict(null);
              }}
              placeholder="Search medicine by generic, brand or strength…"
              options={catalogue
                .filter((item) => item.category === "PHARMACEUTICAL")
                .map((item) => ({
                  value: item.code,
                  label: `${item.genericName || item.name}${item.strength ? ` ${item.strength}` : ""}${item.dosageForm ? ` · ${item.dosageForm}` : ""}`,
                  detail: `KES ${Number(item.unitPrice).toLocaleString()} each`,
                }))}
            />
          </label>
          {medicine && (
            <>
              <label className="span2">
                Diagnosis / clinical indication *
                <input
                  name="medicineIndication"
                  required
                  defaultValue={
                    savedDiagnoses.find((item) => item.primary)?.description ||
                    ""
                  }
                />
              </label>
              <label>
                Dose units per administration *
                <input
                  name="doseQuantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={doseQuantity}
                  onChange={(event) =>
                    setDoseQuantity(Number(event.target.value) || 0)
                  }
                  required
                />
              </label>
              <label>
                Dose instruction *
                <input name="dose" required placeholder="e.g. 1 tablet" />
              </label>
              <label>
                Route *
                <select name="route">
                  <option>Oral</option>
                  <option>Topical</option>
                  <option>Inhaled</option>
                  <option>IM</option>
                  <option>IV</option>
                </select>
              </label>
              <label>
                Frequency *
                <select
                  value={frequencyPerDay}
                  onChange={(event) =>
                    setFrequencyPerDay(Number(event.target.value))
                  }
                >
                  <option value={1}>Once daily</option>
                  <option value={2}>Twice daily</option>
                  <option value={3}>Three times daily</option>
                  <option value={4}>Four times daily</option>
                </select>
                <input
                  name="frequency"
                  type="hidden"
                  value={
                    frequencyPerDay === 1
                      ? "Once daily"
                      : frequencyPerDay === 2
                        ? "Twice daily"
                        : frequencyPerDay === 3
                          ? "Three times daily"
                          : "Four times daily"
                  }
                />
              </label>
              <label>
                Duration in days *
                <input
                  name="durationDays"
                  type="number"
                  min="1"
                  max="3650"
                  value={durationDays}
                  onChange={(event) =>
                    setDurationDays(Number(event.target.value) || 0)
                  }
                  required
                />
                <input
                  name="duration"
                  type="hidden"
                  value={`${durationDays} days`}
                />
              </label>
              <label>
                Start date *
                <input
                  name="startDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label>
                Stop date
                <input name="stopDate" type="date" />
              </label>
              <label>
                Quantity *
                <input
                  name="quantity"
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={dispenseQuantity}
                  onChange={(event) =>
                    setDispenseQuantity(Number(event.target.value) || 0)
                  }
                />
                <small>
                  Calculated as dose units × administrations/day × days. Adjust
                  only when pack size or clinical instructions require it.
                </small>
              </label>
              <label className="span2">
                <span>
                  <input name="quantityConfirmed" type="checkbox" required /> I
                  reviewed and confirm the dispensing quantity *
                </span>
              </label>
              <label className="span2">
                Patient instructions *
                <input
                  name="medicineInstructions"
                  required
                  placeholder="How and when the patient should take this medicine"
                />
              </label>
              <label>
                Dose timing
                <select name="doseTiming">
                  <option value="SCHEDULED">Scheduled course</option>
                  <option value="STAT">STAT dose</option>
                  <option value="STAT_THEN_SCHEDULED">
                    STAT then scheduled course
                  </option>
                </select>
              </label>
              <label>
                Sequence note
                <input
                  name="sequenceNote"
                  placeholder="Document STAT-to-course sequence"
                />
              </label>
              {duplicateConflict && (
                <div className="span2 dangerPanel">
                  <strong>
                    {duplicateConflict.code === "SAME_VISIT_DUPLICATE"
                      ? "Medicine already prescribed in this visit"
                      : "Exact active duplicate detected"}
                  </strong>
                  <span>
                    {String(
                      duplicateConflict.existing.genericName || "Medicine",
                    )}{" "}
                    {String(duplicateConflict.existing.strength || "")} ·{" "}
                    {String(duplicateConflict.existing.dosageForm || "")} ·{" "}
                    {String(duplicateConflict.existing.route || "")} ·{" "}
                    {String(duplicateConflict.existing.frequency || "")}
                  </span>
                  <span>
                    {duplicateConflict.code === "SAME_VISIT_DUPLICATE"
                      ? "A second order is not allowed. Edit the existing prescription or cancel."
                      : "Choose what to do with the existing prescription. A clinical reason is mandatory."}
                  </span>
                  <label>
                    Decision *
                    <select name="duplicateAction" required defaultValue="">
                      <option value="">Cancel and review</option>
                      <option value="EDIT_EXISTING">
                        Edit existing prescription
                      </option>
                      {duplicateConflict.code === "EXACT_DUPLICATE" && (
                        <>
                          <option value="REPLACE_EXISTING">
                            Replace existing prescription
                          </option>
                          <option value="KEEP_BOTH">
                            Override and keep both
                          </option>
                        </>
                      )}
                    </select>
                  </label>
                  <label>
                    Clinical justification *
                    <textarea
                      name="duplicateReason"
                      required
                      minLength={10}
                      rows={2}
                    />
                  </label>
                </div>
              )}
            </>
          )}
          <div className="span2 submitBar">
            <span>
              Save a draft for review, or submit it to pharmacy and billing.
            </span>
            <div>
              <button
                type="button"
                className="secondary"
                disabled={savingPrescription}
                onClick={(event) => act(event, "SAVE_PRESCRIPTION")}
              >
                Save for later
              </button>{" "}
              <button
                type="button"
                className="primary"
                disabled={savingPrescription}
                onClick={(event) => act(event, "SAVE_PRESCRIPTION", true)}
              >
                {savingPrescription ? "Sending…" : "Send to pharmacy"}
              </button>
            </div>
          </div>
        </ClinicalSection>
        <ClinicalSection
          number="7"
          title="Plan & completion"
          description="Signing locks this encounter and routes the visit."
          active={activeStep === 7}
          onOpen={() => setActiveStep(7)}
        >
          <label className="span2">
            Management plan *
            <textarea
              name="plan"
              minLength={2}
              rows={4}
              defaultValue={savedPlan.plan || ""}
            />
          </label>
          <label>
            Disposition *
            <select
              name="disposition"
              defaultValue={savedPlan.disposition || "OUTPATIENT"}
            >
              <option value="OUTPATIENT">Continue outpatient care</option>
              <option value="ADMIT">Admit</option>
              <option value="REFER">Refer</option>
            </select>
          </label>
          <label>
            Follow-up date
            <input
              name="followUpDate"
              type="date"
              defaultValue={savedPlan.followUpDate || ""}
            />
          </label>
          <label className="span2 confidential">
            Confidential clinician note
            <textarea
              name="confidentialNote"
              rows={3}
              defaultValue={savedPlan.confidentialNote || ""}
            />
            <small>
              Restricted clinical content; never shown in reception or public
              queues.
            </small>
          </label>
          {onOpenServicePoints && <div className="span2 clinicalBoundary"><strong>Referral or specialty record</strong><span>Save the clinical notes first, then open the connected service-point record. A referral must be sent before a REFER disposition can be signed.</span><button className="secondary" type="button" onClick={() => onOpenServicePoints(visit.id)}>Open service points</button></div>}
        </ClinicalSection>
        <div className={`signBar ${activeStep === 7 ? "" : "stepHidden"}`}>
          <div>
            <strong>Ready to sign?</strong>
            <span>
              Review the diagnosis, orders, prescription and disposition. A
              signed encounter cannot be silently overwritten.
            </span>
          </div>
          <button
            type="button"
            className="primary"
            onClick={(event) => act(event, "SIGN")}
          >
            Sign &amp; send to next service
          </button>
        </div>
      </form>
    </>
  );
}

function FindingsGrid({
  prefix,
  findings,
  values = {},
}: {
  prefix: string;
  findings: readonly FindingDefinition[];
  values?: Record<string, string>;
}) {
  return (
    <div className="findingsGrid">
      {findings.map(({ key, label, options }) => (
        <label key={key}>
          {label}
          <select
            name={`${prefix}_${key}`}
            defaultValue={
              values[label] && options.includes(values[label])
                ? values[label]
                : options[0]
            }
          >
            {options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function ClinicalSection({
  number,
  title,
  description,
  active,
  onOpen,
  children,
}: {
  number: string;
  title: string;
  description: string;
  active: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`clinicalSection ${active ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className="clinicalSectionHeader"
        onClick={onOpen}
        aria-expanded={active}
      >
        <b>{number}</b>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <i>{active ? "−" : "+"}</i>
      </button>
      <div className="sectionGrid" aria-hidden={!active}>
        {children}
      </div>
    </section>
  );
}
