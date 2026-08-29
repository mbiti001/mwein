# Mwein Cloud EMR Implementation Plan

## Product Goal

Mwein Cloud EMR is designed for Kenyan outpatient and primary care facilities that need reliable registration, clinical documentation, prescription capture, visit summaries, lab and pharmacy workflows, SHA billing support, reporting, and privacy controls. The prototype in `index.html` demonstrates the core user experience and the implementation direction for a production cloud system.

## Production Architecture

- Frontend: responsive web app for clinic desktops, tablets, and mobile browsers.
- API: facility-tenanted REST or GraphQL service with strict role-based access.
- Database: encrypted relational clinical store with immutable audit events.
- Offline support: browser draft storage, signed sync queue, conflict review, and recovery workflow.
- Interoperability: FHIR-ready mappings for Patient, Encounter, Observation, MedicationRequest, DiagnosticReport, Claim, and AuditEvent.
- Reporting: daily facility summaries, claims exception lists, data quality dashboards, and compliance evidence exports.

## Kenya Readiness

- Data Protection Act posture: ODPC registration tracking, DPIA evidence, access review, consent basis, retention schedule, and data subject request process.
- Digital health posture: facility onboarding pack, system certification evidence, audit log integrity, encrypted exchange metadata, and sandbox testing before any national exchange submission.
- SHA readiness: claim packet validation, coded diagnosis, itemized services, lab result attachments, submission status, and exception handling.
- Operational fit: supports outpatient visits, ANC, chronic disease review, lab, pharmacy, emergency stabilization, and local reporting.

## Security Controls

- Multi-factor authentication for staff accounts.
- Role templates for admin, clinician, nurse, lab, pharmacy, billing, and compliance users.
- Least-privilege access by facility, department, and record purpose.
- Encrypted data at rest and in transit.
- Immutable audit log with user, timestamp, record, event, and integrity status.
- Backup schedule, recovery drills, and incident register.
- Break-glass access with supervisor review.

## Minimum Data Model

- Patient: identifiers, demographics, contacts, county, sub-county, residence, next of kin, consent, payer program.
- Encounter: visit type, triage, vitals, notes, diagnosis, plan, clinician signature, timestamps.
- Order: lab, imaging, pharmacy, status, priority, linked encounter, result or dispense data.
- Prescription: medicine, dose, frequency, duration, instructions, allergy review status, linked encounter.
- Claim: payer, diagnosis code, items, attachments, amount, status, exception reason.
- AuditEvent: actor, action, record, timestamp, device, facility, integrity hash.

## Rollout Plan

1. Prototype review: validate workflows with clinicians, nurses, lab, pharmacy, billing, and facility admin.
2. Production build: implement authenticated cloud backend, database schema, audit service, and offline sync.
3. Pilot: run a two-week parallel paper and EMR workflow at one facility.
4. Compliance review: complete DPIA, access matrix, retention schedule, backup drill, and incident workflow.
5. Integration phase: validate SHA claim packet structure and prepare national exchange sandbox testing.
6. Scale: add multi-facility tenancy, advanced reporting, stock management, appointment scheduling, and patient messaging.

## Demo Notes

The current prototype is a single self-contained static HTML app. It stores demo data in browser localStorage and exports a sample daily report as JSON. It is not yet a production medical record system, but it is structured to demonstrate the product scope, workflows, and compliance direction.
