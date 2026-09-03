-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SexAtBirth" AS ENUM ('FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('REGISTERED', 'AWAITING_TRIAGE', 'AWAITING_CLINICIAN', 'UNDER_CONSULTATION', 'ORDERS_PENDING', 'AWAITING_RESULTS', 'AWAITING_PHARMACY', 'AWAITING_PAYMENT', 'ADMITTED', 'REFERRED', 'DISCHARGED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('ROUTINE', 'PRIORITY', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'CALLED', 'IN_PROGRESS', 'TRANSFERRED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('DRAFT', 'SIGNED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LABORATORY', 'IMAGING', 'MEDICATION', 'PROCEDURE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'READY', 'PART_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'CARD', 'BANK', 'SHA', 'INSURER', 'EMPLOYER', 'WAIVER', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REVERSED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceSequence" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "ReferenceSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "estimatedAgeYears" INTEGER,
    "sexAtBirth" "SexAtBirth" NOT NULL,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "occupation" TEXT,
    "maritalStatus" TEXT,
    "disabilityStatus" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'English',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientIdentifier" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuer" TEXT,

    CONSTRAINT "PatientIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientContact" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "relationship" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PatientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "substance" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "visitNumber" TEXT NOT NULL,
    "clinic" TEXT NOT NULL,
    "visitType" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'ROUTINE',
    "status" "VisitStatus" NOT NULL DEFAULT 'REGISTERED',
    "reason" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "servicePoint" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRecord" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "chiefComplaint" TEXT NOT NULL,
    "triageCategory" "Priority" NOT NULL,
    "notes" TEXT,
    "pregnancyStatus" TEXT,
    "lastMenstrualPeriod" DATE,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TriageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" UUID NOT NULL,
    "triageId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "valueDecimal" DECIMAL(12,3),
    "valueText" TEXT,
    "unit" TEXT,
    "abnormal" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "clinicianId" UUID NOT NULL,
    "status" "EncounterStatus" NOT NULL DEFAULT 'DRAFT',
    "noteFormat" TEXT NOT NULL DEFAULT 'SOAP',
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "signedAt" TIMESTAMP(3),
    "correctsEncounterId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icd10Code" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "orderedById" UUID NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "priority" "Priority" NOT NULL DEFAULT 'ROUTINE',
    "displayName" TEXT NOT NULL,
    "clinicalIndication" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaboratoryOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "testCode" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,

    CONSTRAINT "LaboratoryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "examinationCode" TEXT NOT NULL,
    "modality" TEXT NOT NULL,

    CONSTRAINT "ImagingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "medicineCode" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "orderId" UUID,
    "serviceCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "amount" DECIMAL(14,2) NOT NULL,
    "externalReference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "sessionId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "previousEventHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Facility_code_key" ON "Facility"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceSequence_facilityId_kind_year_key" ON "ReferenceSequence"("facilityId", "kind", "year");

-- CreateIndex
CREATE UNIQUE INDEX "User_facilityId_email_key" ON "User"("facilityId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Patient_facilityId_normalizedName_idx" ON "Patient"("facilityId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_facilityId_patientNumber_key" ON "Patient"("facilityId", "patientNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PatientIdentifier_type_value_key" ON "PatientIdentifier"("type", "value");

-- CreateIndex
CREATE INDEX "PatientContact_value_idx" ON "PatientContact"("value");

-- CreateIndex
CREATE INDEX "Visit_facilityId_status_priority_arrivedAt_idx" ON "Visit"("facilityId", "status", "priority", "arrivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_facilityId_visitNumber_key" ON "Visit"("facilityId", "visitNumber");

-- CreateIndex
CREATE INDEX "QueueEntry_servicePoint_status_priority_enteredAt_idx" ON "QueueEntry"("servicePoint", "status", "priority", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TriageRecord_visitId_key" ON "TriageRecord"("visitId");

-- CreateIndex
CREATE INDEX "Observation_triageId_code_idx" ON "Observation"("triageId", "code");

-- CreateIndex
CREATE INDEX "ClinicalOrder_visitId_type_status_idx" ON "ClinicalOrder"("visitId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LaboratoryOrder_orderId_key" ON "LaboratoryOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingOrder_orderId_key" ON "ImagingOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_orderId_key" ON "Prescription"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_visitId_key" ON "Invoice"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_orderId_key" ON "InvoiceItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventHash_key" ON "AuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ReferenceSequence" ADD CONSTRAINT "ReferenceSequence_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIdentifier" ADD CONSTRAINT "PatientIdentifier_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientContact" ADD CONSTRAINT "PatientContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRecord" ADD CONSTRAINT "TriageRecord_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_triageId_fkey" FOREIGN KEY ("triageId") REFERENCES "TriageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaboratoryOrder" ADD CONSTRAINT "LaboratoryOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingOrder" ADD CONSTRAINT "ImagingOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
