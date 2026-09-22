# Clinical workspace modernization

## Review and design decisions

Mwein already connects role-scoped patient tasks and clinical workstations. The main usability opportunities are crowded controls, inconsistent spacing, weak visual hierarchy and a lack of queue filtering. This increment adds a shared RGB design layer, responsive metric cards, visible keyboard focus, reduced-motion support, search/overdue task filtering and a read-only governance snapshot.

Public reference review (22 September 2026):

- [HosiPoa](https://www.hosipoa.co.ke/) describes one patient journey from reception through discharge and connected departmental records. Preserve Mwein's existing shared patient context rather than adding isolated module dashboards.
- [EasyClinic](https://www.easyclinic.io/) presents connected scheduling, EMR, pharmacy, billing, reporting and role access. Use concise workflow controls and readable operational summaries; do not reproduce vendor branding or assume their integrations exist here.
- [DHA certification](https://certification.dha.go.ke/about) is the regulatory reference. The public page did not expose its assessment content during this review. No numerical pass threshold or official metric is invented.

## Evidence boundaries

The snapshot groups existing facility governance gates into privacy/security, clinical assurance, national exchange and continuity. These are Mwein's internal groupings, not an official DHA scoring model. The headline includes all gates; the four group tiles intentionally omit the two AI-specific gates, which remain in the full governance register. Unknown/unavailable evidence is never shown as approved. Only users with admin.dashboard see the snapshot; the server independently enforces that permission.

Queue counts reflect the currently loaded, permission-scoped active visits, not total daily activity. The overdue filter uses the existing priority-sensitive waiting policy, not a claimed DHA wait-time target. No automatic cancellation or clinical discharge was added by this design change.

## Styling boundaries

`modern.css` is the last stylesheet loaded, uses local system fonts and scopes layout overrides to screens. Existing print rules remain intact; shared colour tokens also apply wherever those rules inherit them. RGB tokens use slate text, white cards, a muted teal action colour, amber delays and red emergencies. Status text remains visible alongside colour. No patient data is sent to design or analytics services.

## Release limits

This worktree also contains earlier, unfinished certification and discharge changes. A successful build is not approval to deploy those workflows. Production migration reconciliation, end-to-end clinical transition review, accessibility review and clinician UAT remain necessary before release.

## Validation

Lint, production build and all 213 unit tests passed. The added Playwright regression covers readiness wording, queue search, the overdue control and mobile overflow, but execution is blocked: the required Chromium runtime is absent and its download returns an invalid archive. Browser behaviour and visual appearance have therefore not been verified. No production deployment was performed.
