// Curated naming references, not prescribing instructions or product authorizations.
// Reviewed against KEML 2023 on 2026-10-16; see certification/KENYA-PHARMACY-REFERENCES.md.
export const KEML_SOURCE =
  "https://extranet.who.int/cpcd/sites/default/files/public_file_repository/KEN_Kenya_Kenya-Essential-Medicines-List-2023_2023.pdf";
export type KenyaMedicineReference = {
  id: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  section: string;
  page: number;
  level: number;
  note?: string;
};
export const kenyaMedicineReferences: KenyaMedicineReference[] = [
  {
    id: "PARACETAMOL-500-TAB",
    genericName: "Paracetamol",
    strength: "500 mg",
    dosageForm: "Tablet (scored)",
    section: "3.1.6",
    page: 12,
    level: 1,
  },
  {
    id: "PARACETAMOL-120-LIQ",
    genericName: "Paracetamol",
    strength: "120 mg/5 mL",
    dosageForm: "Oral liquid",
    section: "3.1.6",
    page: 12,
    level: 1,
  },
  {
    id: "CETIRIZINE-10-TAB",
    genericName: "Cetirizine",
    strength: "10 mg",
    dosageForm: "Tablet",
    section: "4.1",
    page: 14,
    level: 2,
  },
  {
    id: "CETIRIZINE-1-LIQ",
    genericName: "Cetirizine",
    strength: "1 mg/mL",
    dosageForm: "Oral liquid",
    section: "4.1",
    page: 14,
    level: 2,
  },
  {
    id: "AMOXICILLIN-250-DISP",
    genericName: "Amoxicillin",
    strength: "250 mg",
    dosageForm: "Tablet (dispersible, scored)",
    section: "7.2.1.2",
    page: 19,
    level: 2,
    note: "Antibiotic: review indication and antimicrobial policy; KEML footnote 93 applies.",
  },
  {
    id: "AMOXICILLIN-500-CAP",
    genericName: "Amoxicillin",
    strength: "500 mg",
    dosageForm: "Capsule",
    section: "7.2.1.2",
    page: 19,
    level: 2,
    note: "Antibiotic: review indication and antimicrobial policy; KEML footnote 93 applies.",
  },
  {
    id: "AMOXICILLIN-125-PFOL",
    genericName: "Amoxicillin",
    strength: "125 mg/5 mL (as trihydrate)",
    dosageForm: "Powder for oral liquid",
    section: "7.2.1.2",
    page: 19,
    level: 2,
    note: "Review reconstitution and dispensing unit. Antibiotic; KEML footnote 93 applies.",
  },
  {
    id: "AMOXICILLIN-250-PFOL",
    genericName: "Amoxicillin",
    strength: "250 mg/5 mL (as trihydrate)",
    dosageForm: "Powder for oral liquid",
    section: "7.2.1.2",
    page: 19,
    level: 2,
    note: "Review reconstitution and dispensing unit. Antibiotic; KEML footnote 93 applies.",
  },
  {
    id: "AMOX-CLAV-875-125-TAB",
    genericName: "Amoxicillin + clavulanic acid",
    strength: "875 mg + 125 mg",
    dosageForm: "Tablet",
    section: "7.2.1.3",
    page: 20,
    level: 4,
    note: "Combination antibiotic. Not interchangeable with amoxicillin alone; KEML footnote 94 applies.",
  },
  {
    id: "AMLODIPINE-5-TAB",
    genericName: "Amlodipine",
    strength: "5 mg",
    dosageForm: "Tablet",
    section: "14.3.4.1",
    page: 50,
    level: 3,
  },
  {
    id: "AMLODIPINE-10-TAB",
    genericName: "Amlodipine",
    strength: "10 mg",
    dosageForm: "Tablet",
    section: "14.3.4.1",
    page: 50,
    level: 3,
  },
  {
    id: "METFORMIN-500-TAB",
    genericName: "Metformin",
    strength: "500 mg (as HCl)",
    dosageForm: "Tablet",
    section: "20.5.2.2.1",
    page: 64,
    level: 3,
    note: "KEML footnote 400 applies; confirm release formulation and patient suitability.",
  },
  {
    id: "METFORMIN-850-TAB",
    genericName: "Metformin",
    strength: "850 mg (as HCl)",
    dosageForm: "Tablet",
    section: "20.5.2.2.1",
    page: 64,
    level: 3,
    note: "KEML footnote 400 applies; confirm release formulation and patient suitability.",
  },
  {
    id: "METFORMIN-1000-TAB",
    genericName: "Metformin",
    strength: "1 g (as HCl)",
    dosageForm: "Tablet",
    section: "20.5.2.2.1",
    page: 64,
    level: 3,
    note: "KEML footnote 400 applies; confirm release formulation and patient suitability.",
  },
];
export function kenyaReferenceDraft(reference: KenyaMedicineReference) {
  return {
    category: "PHARMACEUTICAL" as const,
    code: "KE-" + reference.id,
    name: [
      reference.genericName,
      reference.strength,
      reference.dosageForm,
    ].join(" · "),
    genericName: reference.genericName,
    strength: reference.strength,
    dosageForm: reference.dosageForm,
    active: false,
    description:
      "Naming reference: Kenya Essential Medicines List 2023, section " +
      reference.section +
      ", printed page " +
      reference.page +
      ", level of use " +
      reference.level +
      ". " +
      (reference.note || "") +
      " Facility pharmacist must verify product registration, local scope, formulation, issue unit, price and current PPB alerts before activation. " +
      KEML_SOURCE,
  };
}
