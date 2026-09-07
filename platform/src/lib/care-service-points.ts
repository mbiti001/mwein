export type CareFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";

export type CareField = {
  key: string;
  label: string;
  type: CareFieldType;
  required?: boolean;
  unit?: string;
  placeholder?: string;
  options?: readonly string[];
};

export type CareSection = {
  title: string;
  description?: string;
  fields: readonly CareField[];
};

export type CareServiceProfile = {
  code: "REFERRAL" | "ANC" | "MCH_PNC" | "DIABETES" | "DIALYSIS" | "CANCER" | "SICKLE_CELL" | "WALK_IN";
  label: string;
  clinic?: string;
  description: string;
  templateVersion: string;
  accent: string;
  sections: readonly CareSection[];
};

const yesNoUnknown = ["No", "Yes", "Unknown"] as const;
const reviewStatus = ["Not assessed", "Normal / stable", "Concern identified", "Urgent action required"] as const;

export const careServiceProfiles: readonly CareServiceProfile[] = [
  {
    code: "REFERRAL",
    label: "Referral",
    description: "Create, send, track and close internal or external referrals with feedback.",
    templateVersion: "KE-REFERRAL-1.0",
    accent: "#2563eb",
    sections: [],
  },
  {
    code: "ANC",
    label: "ANC",
    clinic: "ANC",
    description: "Longitudinal antenatal assessment, risk review, birth planning and follow-up.",
    templateVersion: "KE-ANC-2026.1",
    accent: "#a21caf",
    sections: [
      {
        title: "Pregnancy profile",
        description: "Keep pregnancy dates and obstetric history together for every ANC contact.",
        fields: [
          { key: "gravida", label: "Gravida", type: "number", required: true },
          { key: "para", label: "Para", type: "number", required: true },
          { key: "abortions", label: "Abortions", type: "number" },
          { key: "livingChildren", label: "Living children", type: "number" },
          { key: "lmp", label: "Last menstrual period", type: "date" },
          { key: "edd", label: "Estimated delivery date", type: "date", required: true },
          { key: "gestationWeeks", label: "Gestational age", type: "number", unit: "weeks", required: true },
          { key: "previousPregnancies", label: "Previous pregnancy outcomes and complications", type: "textarea" },
        ],
      },
      {
        title: "Assessment and risk",
        fields: [
          { key: "maternalHistory", label: "Medical, surgical and family history", type: "textarea" },
          { key: "currentPregnancy", label: "Current pregnancy concerns", type: "textarea" },
          { key: "dangerSigns", label: "Danger signs reviewed", type: "select", options: reviewStatus, required: true },
          { key: "dangerSignDetails", label: "Danger-sign details and action", type: "textarea" },
          { key: "fundalHeight", label: "Fundal height", type: "number", unit: "cm" },
          { key: "fetalHeartRate", label: "Fetal heart rate", type: "number", unit: "bpm" },
          { key: "liePresentationMovement", label: "Lie, presentation and fetal movement", type: "textarea" },
          { key: "obstetricExamination", label: "Obstetric and general examination", type: "textarea" },
        ],
      },
      {
        title: "Investigations and prevention",
        description: "Orders and verified results remain in the shared patient record; document the clinical review here.",
        fields: [
          { key: "routineTestsReview", label: "Blood/Rh, haemoglobin, urine and infection-screen review", type: "textarea" },
          { key: "ultrasoundReview", label: "Ultrasound review", type: "textarea" },
          { key: "supplements", label: "Supplements and preventive treatment", type: "textarea" },
          { key: "immunisation", label: "Maternal immunisation status", type: "textarea" },
          { key: "nutritionEducation", label: "Nutrition, education and counselling", type: "textarea" },
          { key: "birthPreparedness", label: "Birth preparedness and complication plan", type: "textarea", required: true },
        ],
      },
      {
        title: "Plan and outcome",
        fields: [
          { key: "riskFactors", label: "Maternal or fetal risk factors", type: "textarea" },
          { key: "carePlan", label: "Care plan, medication review and referral", type: "textarea", required: true },
          { key: "pregnancyOutcome", label: "Pregnancy outcome, when known", type: "textarea" },
        ],
      },
    ],
  },
  {
    code: "MCH_PNC",
    label: "MCH / PNC",
    clinic: "MCH / PNC",
    description: "Linked mother-and-child follow-up covering postnatal, newborn and child health.",
    templateVersion: "KE-MCH-PNC-2026.1",
    accent: "#db2777",
    sections: [
      {
        title: "Contact",
        fields: [
          { key: "reviewType", label: "Review type", type: "select", required: true, options: ["Mother postnatal review", "Newborn review", "Mother and newborn review", "Child welfare visit"] },
          { key: "deliveryDate", label: "Delivery date", type: "date" },
          { key: "deliveryOutcome", label: "Delivery and newborn outcome", type: "textarea" },
          { key: "maternalWellbeing", label: "Maternal physical and emotional wellbeing", type: "select", options: reviewStatus, required: true },
          { key: "newbornWellbeing", label: "Newborn or child wellbeing", type: "select", options: reviewStatus },
          { key: "dangerSigns", label: "Maternal/newborn danger signs and action", type: "textarea" },
        ],
      },
      {
        title: "Feeding, growth and development",
        fields: [
          { key: "feeding", label: "Breastfeeding or feeding assessment", type: "textarea", required: true },
          { key: "childWeight", label: "Child weight", type: "number", unit: "kg" },
          { key: "growthReview", label: "Growth and nutrition review", type: "textarea" },
          { key: "developmentReview", label: "Developmental milestones", type: "textarea" },
          { key: "immunisationReview", label: "Immunisation review and due vaccines", type: "textarea" },
        ],
      },
      {
        title: "Maternal and family plan",
        fields: [
          { key: "familyPlanning", label: "Family-planning counselling or method", type: "textarea" },
          { key: "socialWellbeing", label: "Social wellbeing and safeguarding", type: "textarea" },
          { key: "education", label: "Health education and counselling", type: "textarea" },
          { key: "carePlan", label: "Treatment, referral and follow-up plan", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    code: "DIABETES",
    label: "Diabetes",
    clinic: "Diabetes",
    description: "Focused diabetes review with complications screening and continuity of care.",
    templateVersion: "KE-DM-1.0",
    accent: "#0891b2",
    sections: [
      {
        title: "Control and treatment",
        fields: [
          { key: "diabetesType", label: "Diabetes type", type: "select", required: true, options: ["Type 1", "Type 2", "Gestational", "Other / uncertain"] },
          { key: "symptoms", label: "Current symptoms", type: "textarea" },
          { key: "glucoseReview", label: "Glucose trend or self-monitoring review", type: "textarea", required: true },
          { key: "hba1cReview", label: "HbA1c result and trend", type: "textarea" },
          { key: "medicationAdherence", label: "Medicines, insulin and adherence", type: "textarea", required: true },
          { key: "hypoglycaemia", label: "Hypoglycaemia since last review", type: "select", options: yesNoUnknown },
          { key: "hypoglycaemiaDetails", label: "Hypoglycaemia details and safety plan", type: "textarea" },
        ],
      },
      {
        title: "Complications and prevention",
        fields: [
          { key: "footAssessment", label: "Foot examination and risk", type: "textarea", required: true },
          { key: "eyeScreening", label: "Eye-screening status", type: "textarea" },
          { key: "renalScreening", label: "Renal-screening status", type: "textarea" },
          { key: "cardiovascularRisk", label: "Blood pressure and cardiovascular risk review", type: "textarea" },
          { key: "otherComplications", label: "Neuropathy and other complications", type: "textarea" },
          { key: "lifestyleCounselling", label: "Nutrition, activity and self-care counselling", type: "textarea" },
          { key: "carePlan", label: "Targets, treatment and follow-up plan", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    code: "DIALYSIS",
    label: "Dialysis",
    clinic: "Dialysis",
    description: "Traceable pre-, intra- and post-dialysis session record.",
    templateVersion: "KE-DIALYSIS-1.0",
    accent: "#4f46e5",
    sections: [
      {
        title: "Before dialysis",
        fields: [
          { key: "accessType", label: "Access type and site", type: "textarea", required: true },
          { key: "preWeight", label: "Pre-dialysis weight", type: "number", unit: "kg", required: true },
          { key: "targetWeight", label: "Target dry weight", type: "number", unit: "kg" },
          { key: "preBloodPressure", label: "Pre-dialysis blood pressure", type: "text", required: true },
          { key: "preAssessment", label: "Pre-dialysis assessment and access check", type: "textarea", required: true },
          { key: "infectionScreen", label: "Infection and isolation screen", type: "textarea" },
        ],
      },
      {
        title: "Session",
        fields: [
          { key: "prescription", label: "Dialysis prescription and machine settings", type: "textarea", required: true },
          { key: "sessionObservations", label: "Intra-dialysis observations", type: "textarea" },
          { key: "sessionMedication", label: "Medication given during session", type: "textarea" },
          { key: "complications", label: "Complications and intervention", type: "textarea" },
        ],
      },
      {
        title: "After dialysis",
        fields: [
          { key: "postWeight", label: "Post-dialysis weight", type: "number", unit: "kg", required: true },
          { key: "postBloodPressure", label: "Post-dialysis blood pressure", type: "text", required: true },
          { key: "adequacyReview", label: "Adequacy and laboratory review", type: "textarea" },
          { key: "sessionOutcome", label: "Session outcome and follow-up plan", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    code: "CANCER",
    label: "Cancer",
    clinic: "Cancer care",
    description: "Diagnosis, staging, treatment cycle, toxicity and multidisciplinary follow-up.",
    templateVersion: "KE-ONCOLOGY-1.0",
    accent: "#ca8a04",
    sections: [
      {
        title: "Diagnosis and staging",
        fields: [
          { key: "cancerType", label: "Cancer type and primary site", type: "text", required: true },
          { key: "stage", label: "Stage and staging system", type: "text", required: true },
          { key: "pathology", label: "Pathology and histology summary", type: "textarea", required: true },
          { key: "biomarkers", label: "Biomarkers and molecular findings", type: "textarea" },
          { key: "performanceStatus", label: "Performance status", type: "text" },
        ],
      },
      {
        title: "Treatment contact",
        fields: [
          { key: "treatmentIntent", label: "Treatment intent", type: "select", required: true, options: ["Curative", "Adjuvant", "Neoadjuvant", "Disease control", "Palliative", "Surveillance"] },
          { key: "regimenCycle", label: "Regimen, cycle and treatment date", type: "textarea" },
          { key: "treatmentResponse", label: "Treatment response", type: "textarea" },
          { key: "toxicity", label: "Toxicity and adverse effects", type: "textarea", required: true },
          { key: "investigationReview", label: "Laboratory and imaging review", type: "textarea" },
          { key: "supportiveCare", label: "Supportive, psychosocial and palliative care", type: "textarea" },
          { key: "mdtPlan", label: "Multidisciplinary decision and care plan", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    code: "SICKLE_CELL",
    label: "Sickle Cell",
    clinic: "Sickle-cell care",
    description: "Routine and acute sickle-cell care with crisis and complication tracking.",
    templateVersion: "KE-SCD-1.0",
    accent: "#dc2626",
    sections: [
      {
        title: "Disease profile and current state",
        fields: [
          { key: "genotype", label: "Confirmed genotype", type: "text", required: true },
          { key: "currentSymptoms", label: "Current symptoms or acute complication", type: "textarea", required: true },
          { key: "painScore", label: "Pain score", type: "number", unit: "/10" },
          { key: "crisisHistory", label: "Pain crises and admissions since last review", type: "textarea" },
          { key: "transfusionHistory", label: "Transfusion history and reactions", type: "textarea" },
          { key: "complications", label: "Organ complications and screening", type: "textarea" },
        ],
      },
      {
        title: "Disease-modifying and preventive care",
        fields: [
          { key: "hydroxyurea", label: "Hydroxyurea use, dose and adherence", type: "textarea" },
          { key: "infectionPrevention", label: "Vaccination, prophylaxis and infection prevention", type: "textarea" },
          { key: "laboratoryReview", label: "Haematology and other laboratory review", type: "textarea" },
          { key: "education", label: "Hydration, trigger avoidance and danger-sign education", type: "textarea" },
          { key: "carePlan", label: "Acute or routine treatment and follow-up plan", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    code: "WALK_IN",
    label: "Walk-in",
    clinic: "Walk-in",
    description: "A short, safe route for a specific service without an unrelated clinic workflow.",
    templateVersion: "KE-WALKIN-1.0",
    accent: "#059669",
    sections: [
      {
        title: "Requested service",
        fields: [
          { key: "serviceRequested", label: "Service requested", type: "select", required: true, options: ["Laboratory only", "Pharmacy refill", "Imaging only", "Wound care / minor procedure", "Medical certificate", "Screening", "Other"] },
          { key: "requestSource", label: "Request source or referring clinician/facility", type: "text" },
          { key: "requestDetails", label: "Order, refill or service details", type: "textarea", required: true },
          { key: "safetyScreen", label: "Identity, allergy, indication and immediate-risk checks", type: "textarea", required: true },
          { key: "serviceOutcome", label: "Service delivered and outcome", type: "textarea" },
          { key: "carePlan", label: "Follow-up, escalation or referral plan", type: "textarea", required: true },
        ],
      },
    ],
  },
] as const;

const clinicAliases: Record<string, CareServiceProfile["code"]> = {
  ANC: "ANC",
  "MCH / PNC": "MCH_PNC",
  Diabetes: "DIABETES",
  DM: "DIABETES",
  Dialysis: "DIALYSIS",
  "Cancer care": "CANCER",
  "Sickle-cell care": "SICKLE_CELL",
  "Sickle Cell": "SICKLE_CELL",
  "Walk-in": "WALK_IN",
};

export const careClinicNames = [
  "Outpatient",
  "ANC",
  "MCH / PNC",
  "Diabetes",
  "Dialysis",
  "Cancer care",
  "Sickle-cell care",
  "Walk-in",
  "HTN",
  "Paediatrics",
  "Emergency",
  "Other",
] as const;

export function careServiceProfile(code: string) {
  return careServiceProfiles.find((profile) => profile.code === code);
}

export function careServiceForClinic(clinic: string) {
  const code = clinicAliases[clinic];
  return code ? careServiceProfile(code) : undefined;
}

export function careFieldKeys(code: string) {
  const profile = careServiceProfile(code);
  return new Set(profile?.sections.flatMap((section) => section.fields.map((field) => field.key)) || []);
}

export function requiredCareFields(code: string) {
  const profile = careServiceProfile(code);
  return profile?.sections.flatMap((section) => section.fields.filter((field) => field.required).map((field) => field.key)) || [];
}

export function referralNextStatuses(status: string) {
  const transitions: Record<string, readonly string[]> = {
    DRAFT: ["SENT"],
    SENT: ["ACCEPTED"],
    ACCEPTED: ["ATTENDED"],
    ATTENDED: ["RETURNED", "CLOSED"],
    RETURNED: ["CLOSED"],
    CLOSED: [],
  };
  return transitions[status] || [];
}

export function startOfDayInTimeZone(now: Date, timeZone: string) {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = Object.fromEntries(
    dayFormatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const targetLocalTime = Date.UTC(day.year, day.month - 1, day.day);
  const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let candidate = targetLocalTime;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = Object.fromEntries(
      dateTimeFormatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedLocalTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += targetLocalTime - representedLocalTime;
  }
  return new Date(candidate);
}
