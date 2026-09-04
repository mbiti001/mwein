import { z } from "zod";

export const serviceCatalog = {
  labs: {
    FBC: { name: "Full blood count (FBC) / Full haemogram (hemogram)", specimen: "Blood", price: "600.00" },
    MALARIA: { name: "Malaria test", specimen: "Blood", price: "300.00" },
    GLUCOSE: { name: "Blood glucose", specimen: "Blood", price: "200.00" },
    HBA1C: { name: "HbA1c", specimen: "Blood", price: "1200.00" },
    RENAL: {
      name: "Renal function tests",
      specimen: "Blood",
      price: "1200.00",
    },
    URINALYSIS: { name: "Urinalysis", specimen: "Urine", price: "300.00" },
    UPT: { name: "Urine pregnancy test", specimen: "Urine", price: "300.00" },
  },
  imaging: {
    XRAY_CHEST: { name: "Chest X-ray", modality: "X-RAY", price: "1500.00" },
    ULTRASOUND: {
      name: "Ultrasound",
      modality: "ULTRASOUND",
      price: "2000.00",
    },
  },
  medicines: {
    PARACETAMOL_500: { name: "Paracetamol 500 mg tablet", price: "5.00" },
    AMOXICILLIN_500: { name: "Amoxicillin 500 mg capsule", price: "15.00" },
    METFORMIN_500: { name: "Metformin 500 mg tablet", price: "8.00" },
    AMLODIPINE_5: { name: "Amlodipine 5 mg tablet", price: "10.00" },
    ORS: { name: "Oral rehydration salts sachet", price: "25.00" },
  },
} as const;

export const consultationNotesSchema = z.object({
  chiefComplaint: z.string().trim().min(2).max(1000),
  historyPresentingIllness: z.string().trim().min(2).max(5000),
  symptomDuration: z.string().trim().max(120).optional(),
  reviewOfSystems: z.string().trim().max(3000).optional(),
  pastMedicalHistory: z.string().trim().max(3000).optional(),
  currentMedicines: z.string().trim().max(2000).optional(),
  familySocialHistory: z.string().trim().max(3000).optional(),
  generalExamination: z.string().trim().min(2).max(3000),
  systemicExamination: z.string().trim().max(5000).optional(),
  plan: z.string().trim().max(5000).optional(),
  confidentialNote: z.string().trim().max(3000).optional(),
  followUpDate: z.iso.date().optional(),
  disposition: z.enum(["OUTPATIENT", "ADMIT", "REFER"]),
});

export const diagnosisSchema = z.object({
  code: z.string().trim().min(2).max(30),
  title: z.string().trim().min(2).max(500),
  type: z.enum(["PROVISIONAL", "DIFFERENTIAL", "FINAL"]).default("PROVISIONAL"),
  primary: z.boolean().default(false),
  foundationUri: z
    .url()
    .startsWith("https://id.who.int/icd/entity/")
    .optional(),
});

export const investigationOrderSchema = z
  .object({
  labs: z
    .array(z.string().trim().min(2).max(40))
      .max(20)
      .default([]),
  imaging: z
    .array(z.string().trim().min(2).max(40))
      .max(20)
      .default([]),
  priority: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]).default("ROUTINE"),
  indication: z.string().trim().min(2).max(240),
  })
  .refine(
    (value) => value.labs.length + value.imaging.length > 0,
    "Select at least one investigation",
  );

export const prescriptionSchema = z.object({
  submit: z.boolean().default(false),
  idempotencyKey: z.uuid(),
  duplicateAction: z.enum(["EDIT_EXISTING", "REPLACE_EXISTING", "KEEP_BOTH"]).optional(),
  duplicateReason: z.string().trim().min(10).max(500).optional(),
  prescriptions: z
    .array(
      z.object({
        medicineCode: z.string().trim().min(2).max(40),
        indication: z.string().trim().min(2).max(240),
        dose: z.string().trim().min(1).max(100),
        doseQuantity: z.coerce.number().positive().max(1000).optional(),
        route: z.string().trim().min(1).max(50),
        frequency: z.string().trim().min(1).max(100),
        frequencyPerDay: z.coerce.number().int().positive().max(24).optional(),
        duration: z.string().trim().min(1).max(100).optional(),
        durationDays: z.coerce.number().int().positive().max(3650).optional(),
        startDate: z.coerce.date(),
        stopDate: z.coerce.date().optional(),
        quantity: z.coerce.number().positive().max(10000),
        quantityConfirmed: z.boolean().default(false),
        instructions: z.string().trim().min(2).max(500),
        isPrn: z.boolean().default(false),
        prnIndication: z.string().trim().max(240).optional(),
        doseTiming: z.enum(["SCHEDULED", "STAT", "STAT_THEN_SCHEDULED"]).default("SCHEDULED"),
        sequenceNote: z.string().trim().max(240).optional(),
      }),
    )
    .min(1, "Add at least one medicine")
    .max(20)
    .default([]),
}).superRefine((value, context) => {
  value.prescriptions.forEach((item, index) => {
    if (!item.duration && !item.stopDate) context.addIssue({ code: "custom", path: ["prescriptions", index, "duration"], message: "Duration or stop date is required" });
    if (item.stopDate && item.stopDate < item.startDate) context.addIssue({ code: "custom", path: ["prescriptions", index, "stopDate"], message: "Stop date cannot be before start date" });
    if (item.isPrn && !item.prnIndication) context.addIssue({ code: "custom", path: ["prescriptions", index, "prnIndication"], message: "PRN indication is required" });
    if (item.doseTiming === "STAT_THEN_SCHEDULED" && !item.sequenceNote) context.addIssue({ code: "custom", path: ["prescriptions", index, "sequenceNote"], message: "Document the intended STAT-to-course sequence" });
    if (item.doseQuantity && item.frequencyPerDay && item.durationDays && !item.quantityConfirmed) context.addIssue({ code: "custom", path: ["prescriptions", index, "quantityConfirmed"], message: "Confirm the calculated dispensing quantity" });
  });
  if (value.duplicateAction && !value.duplicateReason) context.addIssue({ code: "custom", path: ["duplicateReason"], message: "Clinical justification is required" });
});

export const signConsultationSchema = z.object({
  disposition: z.enum(["OUTPATIENT", "ADMIT", "REFER"]),
});
