import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();
const password = (process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
if (!password) process.exit(0);
if (password.length < 16)
  throw new Error(
    "BOOTSTRAP_ADMIN_PASSWORD must contain at least 16 characters",
  );

const facility = await db.facility.upsert({
  where: { code: process.env.FACILITY_CODE || "MMS" },
  update: { name: "Mwein Medical Services", timezone: "Africa/Nairobi" },
  create: {
    code: process.env.FACILITY_CODE || "MMS",
    name: "Mwein Medical Services",
    timezone: "Africa/Nairobi",
  },
});

const permissionDefinitions = [
  ["patient.read", "View patient records"],
  ["patient.create", "Register patients"],
  ["visit.read", "View visits and queues"],
  ["visit.create", "Create visits"],
  ["triage.write", "Capture triage"],
  ["encounter.write", "Document consultations"],
  ["order.write", "Create clinical orders"],
  ["laboratory.write", "Record and verify laboratory results"],
  ["imaging.write", "Perform and verify imaging reports"],
  ["pharmacy.dispense", "Review and dispense prescribed medicines"],
  ["inventory.write", "Legacy inventory access"],
  ["inventory.view", "View stock and supply records"],
  ["inventory.receive", "Receive approved purchase orders"],
  ["inventory.count", "Record physical stock counts"],
  ["inventory.adjust", "Approve stock variances"],
  ["inventory.transfer", "Transfer stock between stores"],
  ["inventory.manage_stores", "Create and manage stores"],
  ["procurement.manage_suppliers", "Create and manage suppliers"],
  ["procurement.create", "Draft and submit purchase orders"],
  ["procurement.approve", "Approve or cancel purchase orders"],
  ["billing.read", "View invoices"],
  ["billing.write", "Receive payments and close settled visits"],
  ["billing.reverse", "Reverse payments with a documented reason"],
  ["claims.write", "Prepare and submit payer claims"],
  ["admin.users", "Manage users and roles"],
  ["admin.catalog", "Manage services and commodity catalogue"],
  ["admin.dashboard", "View the facility administration dashboard"],
  ["audit.view", "View append-only audit and session records"],
];
for (const [code, description] of permissionDefinitions)
  await db.permission.upsert({
    where: { code },
    update: { description },
    create: { code, description },
  });
const role = await db.role.upsert({
  where: { code: "SYSTEM_ADMIN" },
  update: {},
  create: { code: "SYSTEM_ADMIN", name: "System administrator", system: true },
});
const permissions = await db.permission.findMany();
for (const permission of permissions)
  await db.rolePermission.upsert({
    where: {
      roleId_permissionId: { roleId: role.id, permissionId: permission.id },
    },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });

const operationalRoles = {
  RECEPTION: ["patient.read", "patient.create", "visit.read", "visit.create"],
  NURSE: ["patient.read", "visit.read", "triage.write"],
  CLINICIAN: ["patient.read", "visit.read", "encounter.write", "order.write"],
  LABORATORY: ["patient.read", "visit.read", "laboratory.write"],
  IMAGING: ["patient.read", "visit.read", "imaging.write"],
  PHARMACY: ["patient.read", "visit.read", "pharmacy.dispense", "inventory.view"],
  INVENTORY_CLERK: ["patient.read", "visit.read", "inventory.view", "inventory.receive", "inventory.count", "inventory.transfer", "inventory.manage_stores", "procurement.manage_suppliers", "procurement.create"],
  PROCUREMENT_APPROVER: ["patient.read", "visit.read", "inventory.view", "inventory.adjust", "procurement.approve"],
  FACILITY_ADMIN: ["patient.read", "visit.read", "billing.read", "admin.dashboard", "admin.users", "admin.catalog", "audit.view", "inventory.view", "procurement.approve"],
  MEDICAL_DIRECTOR: ["patient.read", "visit.read", "encounter.write", "order.write", "admin.dashboard", "audit.view"],
  FINANCE_MANAGER: ["patient.read", "visit.read", "billing.read", "billing.write", "billing.reverse", "claims.write", "admin.dashboard", "audit.view"],
  HR_ADMIN: ["admin.dashboard", "admin.users", "audit.view"],
  AUDITOR: ["admin.dashboard", "audit.view", "billing.read", "inventory.view"],
  BILLING: ["patient.read", "visit.read", "billing.read", "billing.write", "billing.reverse", "claims.write"],
};
for (const [code, permissionCodes] of Object.entries(operationalRoles)) {
  const operationalRole = await db.role.upsert({
    where: { code },
    update: { name: code.charAt(0) + code.slice(1).toLowerCase() },
    create: { code, name: code.charAt(0) + code.slice(1).toLowerCase(), system: true },
  });
  for (const permissionCode of permissionCodes) {
    const permission = permissions.find((item) => item.code === permissionCode);
    if (!permission) throw new Error(`Missing permission ${permissionCode}`);
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: operationalRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: operationalRole.id, permissionId: permission.id },
    });
  }
}

const salt = randomBytes(24);
const passwordHash = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
const user = await db.user.upsert({
  where: {
    facilityId_email: { facilityId: facility.id, email: "admin@mwein.local" },
  },
  update: { displayName: "Mwein System Administrator", status: "ACTIVE" },
  create: {
    facilityId: facility.id,
    email: "admin@mwein.local",
    displayName: "Mwein System Administrator",
    passwordHash,
  },
});
await db.userRole.upsert({
  where: { userId_roleId: { userId: user.id, roleId: role.id } },
  update: {},
  create: { userId: user.id, roleId: role.id },
});

const catalogue = [
  [
    "LABORATORY_TEST",
    "FBC",
    "Full blood count (FBC) / Full haemogram (hemogram)",
    "600.00",
    { specimenType: "Blood" },
  ],
  [
    "LABORATORY_TEST",
    "MALARIA",
    "Malaria test",
    "300.00",
    { specimenType: "Blood" },
  ],
  [
    "LABORATORY_TEST",
    "GLUCOSE",
    "Blood glucose",
    "200.00",
    { specimenType: "Blood" },
  ],
  ["LABORATORY_TEST", "HBA1C", "HbA1c", "1200.00", { specimenType: "Blood" }],
  [
    "LABORATORY_TEST",
    "RENAL",
    "Renal function tests",
    "1200.00",
    { specimenType: "Blood" },
  ],
  [
    "LABORATORY_TEST",
    "URINALYSIS",
    "Urinalysis",
    "300.00",
    { specimenType: "Urine" },
  ],
  [
    "LABORATORY_TEST",
    "UPT",
    "Urine pregnancy test",
    "300.00",
    { specimenType: "Urine" },
  ],
  ["PROCEDURE", "XRAY_CHEST", "Chest X-ray", "1500.00", { modality: "X-RAY" }],
  [
    "PROCEDURE",
    "ULTRASOUND",
    "Ultrasound",
    "2000.00",
    { modality: "ULTRASOUND" },
  ],
  [
    "PHARMACEUTICAL",
    "PARACETAMOL_500",
    "Paracetamol 500 mg tablet",
    "5.00",
    {
      genericName: "Paracetamol",
      medicationConceptId: "paracetamol",
      therapeuticClass: "Analgesic / antipyretic",
      strength: "500 mg",
      dosageForm: "Tablet",
      unitOfMeasure: "tablet",
    },
  ],
  [
    "PHARMACEUTICAL",
    "AMOXICILLIN_500",
    "Amoxicillin 500 mg capsule",
    "15.00",
    {
      genericName: "Amoxicillin",
      medicationConceptId: "amoxicillin",
      therapeuticClass: "Penicillin antibiotic",
      strength: "500 mg",
      dosageForm: "Capsule",
      unitOfMeasure: "capsule",
    },
  ],
  [
    "PHARMACEUTICAL",
    "METFORMIN_500",
    "Metformin 500 mg tablet",
    "8.00",
    {
      genericName: "Metformin",
      medicationConceptId: "metformin",
      therapeuticClass: "Biguanide antidiabetic",
      strength: "500 mg",
      dosageForm: "Tablet",
      unitOfMeasure: "tablet",
    },
  ],
  [
    "PHARMACEUTICAL",
    "AMLODIPINE_5",
    "Amlodipine 5 mg tablet",
    "10.00",
    {
      genericName: "Amlodipine",
      medicationConceptId: "amlodipine",
      therapeuticClass: "Calcium-channel blocker",
      strength: "5 mg",
      dosageForm: "Tablet",
      unitOfMeasure: "tablet",
    },
  ],
  [
    "PHARMACEUTICAL",
    "ORS",
    "Oral rehydration salts sachet",
    "25.00",
    {
      genericName: "Oral rehydration salts",
      medicationConceptId: "oral-rehydration-salts",
      therapeuticClass: "Oral electrolyte replacement",
      dosageForm: "Sachet",
      unitOfMeasure: "sachet",
    },
  ],
];
for (const [category, code, name, unitPrice, detail] of catalogue)
  await db.catalogItem.upsert({
    where: { facilityId_code: { facilityId: facility.id, code } },
    update: {
      ...detail,
      ...(code === "FBC"
        ? {
            name,
            description:
              "Also known as full haemogram, full hemogram, haemogram, hemogram or CBC; all terms use this same complete haematology panel.",
          }
        : {}),
    },
    create: {
      facilityId: facility.id,
      category,
      code,
      name,
      description:
        code === "FBC"
          ? "Also known as full haemogram, full hemogram, haemogram, hemogram or CBC; all terms use this same complete haematology panel."
          : undefined,
      unitPrice,
      ...detail,
    },
  });

const fbc = await db.catalogItem.findUnique({
  where: { facilityId_code: { facilityId: facility.id, code: "FBC" } },
});
if (fbc)
  await db.catalogItem.update({
    where: { id: fbc.id },
    data: {
      synonyms: "FBC|Full Haemogram|Full Hemogram|Complete Blood Count|CBC",
      loincCode: "58410-2",
      department: "Haematology",
      panelOrSingle: "PANEL",
      specimenType: "EDTA whole blood",
      container: "Purple/lavender-top tube",
      method: "Automated haematology analyser",
      turnaroundMinutes: 60,
      reportableToKhis: true,
      khisMapping: "MoH 706: Haematology — Full blood count",
    },
  });
if (
  fbc &&
  (await db.labReferenceRange.count({ where: { catalogItemId: fbc.id } })) === 0
) {
  const source =
    "NWL Pathology User Guide v6.4 (2026); verify locally against analyser, method and served population before clinical use";
  const rows = [];
  const add = (
    analyte,
    unit,
    sexAtBirth,
    minAgeDays,
    maxAgeDays,
    lowerLimit,
    upperLimit,
  ) =>
    rows.push({
      catalogItemId: fbc.id,
      analyte,
      unit,
      sexAtBirth,
      minAgeDays,
      maxAgeDays,
      lowerLimit,
      upperLimit,
      method: "Automated haematology analyser — facility to specify",
      source,
      verifiedAt: new Date(),
    });
  const adult = [
    ["White blood cell count", "×10⁹/L", "MALE", 4.2, 10.6],
    ["White blood cell count", "×10⁹/L", "FEMALE", 4.2, 11.2],
    ["Red blood cell count", "×10¹²/L", "MALE", 4.23, 5.46],
    ["Red blood cell count", "×10¹²/L", "FEMALE", 3.73, 4.96],
    ["Haemoglobin", "g/L", "MALE", 130, 168],
    ["Haemoglobin", "g/L", "FEMALE", 114, 150],
    ["Haematocrit", "L/L", "MALE", 0.39, 0.5],
    ["Haematocrit", "L/L", "FEMALE", 0.35, 0.45],
    ["Mean cell volume", "fL", "ANY", 83.5, 99.5],
    ["Mean cell haemoglobin", "pg", "ANY", 27.5, 33.1],
    ["Mean cell haemoglobin concentration", "g/L", "ANY", 315, 350],
    ["Red cell distribution width", "%", "MALE", 10, 16],
    ["Red cell distribution width", "%", "FEMALE", 10, 15.9],
    ["Platelet count", "×10⁹/L", "MALE", 130, 370],
    ["Platelet count", "×10⁹/L", "FEMALE", 135, 400],
    ["Neutrophils", "×10⁹/L", "ANY", 2, 7.1],
    ["Lymphocytes", "×10⁹/L", "ANY", 1.1, 3.6],
    ["Monocytes", "×10⁹/L", "ANY", 0.3, 0.9],
    ["Eosinophils", "×10⁹/L", "ANY", 0, 0.5],
    ["Basophils", "×10⁹/L", "ANY", 0, 0.2],
  ];
  adult.forEach(([a, u, s, lo, hi]) => add(a, u, s, 6570, null, lo, hi));
  const ageBands = [
    [0, 0],
    [1, 6],
    [7, 30],
    [31, 90],
    [91, 182],
    [183, 365],
    [366, 730],
    [731, 2190],
    [2191, 4380],
  ];
  const red = [
    [
      "Red blood cell count",
      "×10¹²/L",
      [
        [4, 5.5],
        [3.9, 5.4],
        [3.4, 6.3],
        [3, 5.3],
        [3.3, 5],
        [3.9, 5.3],
        [4.1, 5.3],
        [4.2, 5],
        [3.1, 5.1],
      ],
    ],
    [
      "Haematocrit",
      "L/L",
      [
        [0.42, 0.6],
        [0.36, 0.6],
        [0.3, 0.66],
        [0.27, 0.55],
        [0.27, 0.4],
        [0.31, 0.41],
        [0.33, 0.41],
        [0.34, 0.4],
        [0.32, 0.43],
      ],
    ],
    [
      "Mean cell volume",
      "fL",
      [
        [97, 115],
        [95, 112],
        [85, 110],
        [82, 97],
        [70, 88],
        [70, 85],
        [71, 84],
        [73, 86],
        [75, 89.5],
      ],
    ],
    [
      "Mean cell haemoglobin",
      "pg",
      [
        [31, 39],
        [31, 37],
        [29, 36],
        [25, 32],
        [23, 30],
        [25, 35],
        [23, 31],
        [24, 30],
        [25.6, 30.9],
      ],
    ],
  ];
  red.forEach(([analyte, unit, values]) =>
    values.forEach(([lo, hi], index) =>
      add(analyte, unit, "ANY", ageBands[index][0], ageBands[index][1], lo, hi),
    ),
  );
  [
    [0, 182, 95, 200],
    [183, 2190, 105, 135],
    [2191, 4380, 111, 147],
  ].forEach(([min, max, lo, hi]) =>
    add("Haemoglobin", "g/L", "ANY", min, max, lo, hi),
  );
  const white = [
    [
      "White blood cell count",
      [
        [9, 30],
        [6, 16],
        [6, 18.4],
        [6, 19.5],
        [6, 16],
        [5.9, 16.6],
        [6, 17.5],
        [5, 14],
        [4, 13.5],
      ],
    ],
    [
      "Neutrophils",
      [
        [2, 23.5],
        [2, 9],
        [1.2, 9],
        [1.2, 9],
        [0.7, 4.7],
        [1.1, 5.6],
        [1.5, 8],
        [1.5, 8],
        [1.5, 7],
      ],
    ],
    [
      "Lymphocytes",
      [
        [2, 10],
        [2, 8],
        [2, 9],
        [2, 9],
        [1.5, 10.5],
        [3.2, 11.3],
        [4, 10],
        [1.5, 7],
        [1.5, 4],
      ],
    ],
    [
      "Monocytes",
      [
        [0.2, 2],
        [0.2, 2.2],
        [0.2, 2],
        [0.2, 2],
        [0.2, 2],
        [0.2, 1],
        [0.2, 1],
        [0.2, 1],
        [0.2, 1],
      ],
    ],
    [
      "Eosinophils",
      [
        [0, 0.8],
        [0, 0.8],
        [0, 0.8],
        [0, 0.6],
        [0, 0.4],
        [0.1, 1],
        [0.1, 1],
        [0.1, 0.4],
        [0.1, 0.4],
      ],
    ],
    [
      "Basophils",
      [
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
        [0, 0.1],
      ],
    ],
  ];
  white.forEach(([analyte, values]) =>
    values.forEach(([lo, hi], index) =>
      add(
        analyte,
        "×10⁹/L",
        "ANY",
        ageBands[index][0],
        ageBands[index][1],
        lo,
        hi,
      ),
    ),
  );
  [
    [0, 0, 150, 350],
    [1, 6, 150, 450],
    [7, 30, 150, 500],
    [31, 90, 150, 550],
    [91, 4380, 200, 450],
  ].forEach(([min, max, lo, hi]) =>
    add("Platelet count", "×10⁹/L", "ANY", min, max, lo, hi),
  );
  await db.labReferenceRange.createMany({ data: rows });
}

// Starter panels are source-labelled configuration scaffolding. Each laboratory
// must verify or replace them for its analyser, method and served population.
const starterSource =
  "Starter interval — facility laboratory must verify against its analyser, method and population before clinical use";
async function seedPanel(code, ranges) {
  const item = await db.catalogItem.findUnique({
    where: { facilityId_code: { facilityId: facility.id, code } },
  });
  if (
    !item ||
    (await db.labReferenceRange.count({ where: { catalogItemId: item.id } }))
  )
    return;
  await db.labReferenceRange.createMany({
    data: ranges.map((range) => ({
      catalogItemId: item.id,
      sexAtBirth: "ANY",
      active: true,
      source: starterSource,
      method: "Facility to specify",
      ...range,
    })),
  });
}
await seedPanel("RENAL", [
  {
    analyte: "Sodium",
    unit: "mmol/L",
    lowerLimit: 135,
    upperLimit: 145,
    criticalLow: 120,
    criticalHigh: 160,
  },
  {
    analyte: "Potassium",
    unit: "mmol/L",
    lowerLimit: 3.5,
    upperLimit: 5.1,
    criticalLow: 2.5,
    criticalHigh: 6.5,
  },
  { analyte: "Chloride", unit: "mmol/L", lowerLimit: 98, upperLimit: 107 },
  { analyte: "Urea", unit: "mmol/L", lowerLimit: 2.5, upperLimit: 7.8 },
  { analyte: "Creatinine", unit: "µmol/L", lowerLimit: 45, upperLimit: 110 },
  { analyte: "eGFR", unit: "mL/min/1.73m²", lowerLimit: 90 },
]);
await seedPanel("GLUCOSE", [
  {
    analyte: "Glucose",
    unit: "mmol/L",
    lowerLimit: 3.9,
    upperLimit: 7.8,
    criticalLow: 2.5,
    criticalHigh: 25,
  },
]);
await seedPanel("HBA1C", [
  { analyte: "HbA1c", unit: "%", lowerLimit: 4, upperLimit: 5.6 },
]);
await seedPanel("MALARIA", [
  { analyte: "Malaria parasites", qualitativeValues: "Negative|Positive" },
]);
await seedPanel("UPT", [
  {
    analyte: "Urine hCG",
    qualitativeValues: "Negative|Positive|Indeterminate",
  },
]);
await seedPanel("URINALYSIS", [
  {
    analyte: "Colour",
    qualitativeValues: "Pale yellow|Yellow|Amber|Red|Brown|Other",
  },
  {
    analyte: "Appearance",
    qualitativeValues: "Clear|Slightly cloudy|Cloudy|Turbid",
  },
  { analyte: "pH", lowerLimit: 5, upperLimit: 8 },
  { analyte: "Specific gravity", lowerLimit: 1.005, upperLimit: 1.03 },
  { analyte: "Protein", qualitativeValues: "Negative|Trace|1+|2+|3+|4+" },
  { analyte: "Glucose", qualitativeValues: "Negative|Trace|1+|2+|3+|4+" },
  { analyte: "Ketones", qualitativeValues: "Negative|Trace|1+|2+|3+" },
  { analyte: "Blood", qualitativeValues: "Negative|Trace|1+|2+|3+" },
  { analyte: "Nitrite", qualitativeValues: "Negative|Positive" },
  {
    analyte: "Leukocyte esterase",
    qualitativeValues: "Negative|Trace|1+|2+|3+",
  },
]);

const missingFbcAdultComponents = [
  ["Mean platelet volume", "fL", 7, 12],
  ["Neutrophils %", "%", 40, 75],
  ["Lymphocytes %", "%", 20, 45],
  ["Monocytes %", "%", 2, 10],
  ["Eosinophils %", "%", 1, 6],
  ["Basophils %", "%", 0, 2],
];
for (const [analyte, unit, lowerLimit, upperLimit] of missingFbcAdultComponents)
  if (
    fbc &&
    !(await db.labReferenceRange.count({ where: { catalogItemId: fbc.id, analyte } }))
  )
    await db.labReferenceRange.create({
      data: {
        catalogItemId: fbc.id,
        analyte,
        unit,
        sexAtBirth: "ANY",
        minAgeDays: 6570,
        lowerLimit,
        upperLimit,
        method: "Automated haematology analyser — facility to specify",
        source: starterSource,
        active: true,
      },
    });

const fbcCritical = [
  ["Haemoglobin", 50, 200],
  ["White blood cell count", 2, 30],
  ["Platelet count", 20, 1000],
  ["Haematocrit", 0.15, 0.6],
  ["Neutrophils", 0.5, null],
];
for (const [analyte, criticalLow, criticalHigh] of fbcCritical)
  if (fbc)
    await db.labReferenceRange.updateMany({
      where: { catalogItemId: fbc.id, analyte },
      data: { criticalLow, criticalHigh },
    });

const fbcComponents = [
  ["White blood cell count", "FBC-WBC", "6690-2", "10*9/L"],
  ["Red blood cell count", "FBC-RBC", "789-8", "10*12/L"],
  ["Haemoglobin", "FBC-HB", "718-7", "g/L"],
  ["Haematocrit", "FBC-HCT", "4544-3", "1"],
  ["Mean cell volume", "FBC-MCV", "787-2", "fL"],
  ["Mean cell haemoglobin", "FBC-MCH", "785-6", "pg"],
  ["Mean cell haemoglobin concentration", "FBC-MCHC", "786-4", "g/L"],
  ["Red cell distribution width", "FBC-RDW", "788-0", "%"],
  ["Platelet count", "FBC-PLT", "777-3", "10*9/L"],
  ["Mean platelet volume", "FBC-MPV", "32623-1", "fL"],
  ["Neutrophils %", "FBC-NEUT-PCT", "770-8", "%"],
  ["Lymphocytes %", "FBC-LYMPH-PCT", "736-9", "%"],
  ["Monocytes %", "FBC-MONO-PCT", "5905-5", "%"],
  ["Eosinophils %", "FBC-EOS-PCT", "713-8", "%"],
  ["Basophils %", "FBC-BASO-PCT", "706-2", "%"],
  ["Neutrophils", "FBC-NEUT-ABS", "751-8", "10*9/L"],
  ["Lymphocytes", "FBC-LYMPH-ABS", "731-0", "10*9/L"],
  ["Monocytes", "FBC-MONO-ABS", "742-7", "10*9/L"],
  ["Eosinophils", "FBC-EOS-ABS", "711-2", "10*9/L"],
  ["Basophils", "FBC-BASO-ABS", "704-7", "10*9/L"],
];
for (const [analyte, componentCode, loincCode, unitUcum] of fbcComponents)
  if (fbc)
    await db.labReferenceRange.updateMany({
      where: { catalogItemId: fbc.id, analyte },
      data: {
        componentCode,
        loincCode,
        unitUcum,
        displayOrder: fbcComponents.findIndex((item) => item[0] === analyte) + 1,
      },
    });

// Mwein's analyser is a Zybio Z3 three-part differential instrument. Retire only
// the generic starter ranges created by earlier builds; preserve any laboratory-
// approved custom ranges already entered by staff.
const z3Method =
  "WBC, RBC and platelet counts by electrical impedance; haemoglobin by colorimetry; three-part WBC classification by cell-volume distribution. Red-cell and platelet indices are analyser-calculated.";
const z3Source =
  "Zybio Z3 Operation Manual and Mwein Medical Services provisional adult reference interval set (MMS-Z3-FBC-ADULT-v1.0). Provisional — pending local verification.";
if (fbc) {
  await db.catalogItem.update({
    where: { id: fbc.id },
    data: {
      name: "Full Blood Count",
      description:
        "Zybio Z3 three-part FBC. Also known as Full Haemogram, FBC or CBC. MID cells combine monocytes, eosinophils and basophils.",
      specimenType: "EDTA whole blood",
      method: z3Method,
    },
  });
  await db.labReferenceRange.updateMany({
    where: {
      catalogItemId: fbc.id,
      OR: [
        { source: { contains: "NWL Pathology" } },
        { source: { contains: "Starter interval" } },
      ],
    },
    data: { active: false },
  });

  const existingZ3 = await db.labReferenceRange.count({
    where: { catalogItemId: fbc.id, analyser: "Zybio Z3" },
  });
  if (!existingZ3) {
    const base = {
      catalogItemId: fbc.id,
      sexAtBirth: "ANY",
      minAgeDays: 6570,
      method: z3Method,
      analyser: "Zybio Z3",
      source: z3Source,
      active: true,
    };
    const z3Rows = [
      ["White blood cell count", "FBC-WBC", "×10⁹/L", "10*9/L", 4, 11],
      ["Absolute lymphocyte count", "FBC-LYM-ABS", "×10⁹/L", "10*9/L", 1, 4],
      ["Absolute MID-cell count", "FBC-MID-ABS", "×10⁹/L", "10*9/L", 0.2, 1.5],
      ["Absolute granulocyte count", "FBC-GRAN-ABS", "×10⁹/L", "10*9/L", 1.5, 7.5],
      ["Lymphocytes", "FBC-LYM-PCT", "%", "%", 20, 45],
      ["MID cells", "FBC-MID-PCT", "%", "%", 2, 15],
      ["Granulocytes", "FBC-GRAN-PCT", "%", "%", 40, 75],
      ["Mean cell volume", "FBC-MCV", "fL", "fL", 80, 100],
      ["Mean cell haemoglobin", "FBC-MCH", "pg", "pg", 27, 33],
      ["Mean cell haemoglobin concentration", "FBC-MCHC", "g/dL", "g/dL", 32, 36],
      ["Red-cell distribution width–CV", "FBC-RDW-CV", "%", "%", 11.5, 15],
      ["Platelet count", "FBC-PLT", "×10⁹/L", "10*9/L", 150, 450],
      ["Red-cell distribution width–SD", "FBC-RDW-SD", "fL", "fL", null, null],
      ["Mean platelet volume", "FBC-MPV", "fL", "fL", null, null],
      ["Platelet distribution width", "FBC-PDW", "fL", "fL", null, null],
      ["Plateletcrit", "FBC-PCT", "%", "%", null, null],
      ["Platelet large-cell ratio", "FBC-P-LCR", "%", "%", null, null],
      ["Platelet large-cell count", "FBC-P-LCC", "×10⁹/L", "10*9/L", null, null],
    ].map(([analyte, componentCode, unit, unitUcum, lowerLimit, upperLimit], index) => ({
      ...base, analyte, componentCode, unit, unitUcum, lowerLimit, upperLimit,
      displayOrder: index < 12 ? index + 1 : index + 4,
    }));
    z3Rows.splice(7, 0,
      { ...base, analyte: "Red blood cell count", componentCode: "FBC-RBC", unit: "×10¹²/L", unitUcum: "10*12/L", sexAtBirth: "MALE", lowerLimit: 4.5, upperLimit: 6, displayOrder: 8 },
      { ...base, analyte: "Red blood cell count", componentCode: "FBC-RBC", unit: "×10¹²/L", unitUcum: "10*12/L", sexAtBirth: "FEMALE", lowerLimit: 4, upperLimit: 5.5, displayOrder: 8 },
      { ...base, analyte: "Haemoglobin", componentCode: "FBC-HGB", loincCode: "718-7", unit: "g/dL", unitUcum: "g/dL", sexAtBirth: "MALE", lowerLimit: 13, upperLimit: 17.5, criticalLow: 5, criticalHigh: 20, displayOrder: 9 },
      { ...base, analyte: "Haemoglobin", componentCode: "FBC-HGB", loincCode: "718-7", unit: "g/dL", unitUcum: "g/dL", sexAtBirth: "FEMALE", lowerLimit: 12, upperLimit: 15.5, criticalLow: 5, criticalHigh: 20, displayOrder: 9 },
      { ...base, analyte: "Haematocrit", componentCode: "FBC-HCT", unit: "%", unitUcum: "%", sexAtBirth: "MALE", lowerLimit: 40, upperLimit: 52, criticalLow: 15, criticalHigh: 60, displayOrder: 10 },
      { ...base, analyte: "Haematocrit", componentCode: "FBC-HCT", unit: "%", unitUcum: "%", sexAtBirth: "FEMALE", lowerLimit: 36, upperLimit: 48, criticalLow: 15, criticalHigh: 60, displayOrder: 10 },
    );
    await db.labReferenceRange.createMany({ data: z3Rows });
  }
}

const manualDifferential = await db.catalogItem.upsert({
  where: { facilityId_code: { facilityId: facility.id, code: "LAB-HEM-MANDIFF" } },
  update: {},
  create: {
    facilityId: facility.id,
    category: "LABORATORY_TEST",
    code: "LAB-HEM-MANDIFF",
    name: "Peripheral blood film with manual differential",
    description: "Separate manual microscopy examination; results are not produced by the Zybio Z3.",
    unitPrice: "600.00",
    department: "Haematology",
    panelOrSingle: "PANEL",
    specimenType: "EDTA whole blood",
    method: "Manual microscopy",
    turnaroundMinutes: 120,
  },
});
if (!(await db.labReferenceRange.count({ where: { catalogItemId: manualDifferential.id } })))
  await db.labReferenceRange.createMany({
    data: ["Neutrophils %", "Lymphocytes %", "Monocytes %", "Eosinophils %", "Basophils %", "Morphology comments"].map((analyte, displayOrder) => ({
      catalogItemId: manualDifferential.id,
      analyte,
      unit: analyte.endsWith("%") ? "%" : null,
      displayOrder: displayOrder + 1,
      method: "Manual microscopy",
      source: "Facility manual differential procedure — laboratory approval required",
      active: true,
    })),
  });
await db.$disconnect();
