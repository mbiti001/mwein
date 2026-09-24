# Workforce MFA and recovery implementation

22 September 2026. Resumed under the user's instruction to complete the remaining DHA readiness checklist, following the Google identity/MFA options review. Implemented in the remediation checkout; no live enrollment, production configuration, deployment or certification attestation is implied.

## Staff experience

Staff retain their individual Mwein accounts and add time-based six-digit codes using Google Authenticator or another compatible authenticator. QR images are generated inside the application. Google sign-in, Gmail recovery links and Google account linking are not implemented or claimed. [Google documents compatible one-time codes and use without a Google account](https://support.google.com/accounts/answer/1066447). Optional Google account synchronization is a staff/device policy decision to include in the privacy review; on-device use does not require a Google identity provider integration.

First sign-in requires replacing any temporary password, then enrolling an authenticator. Ten single-use recovery codes are shown once after successful enrollment. Store them separately and securely. Account security supports replacing the authenticator and regenerating recovery codes after proving the current password and an existing factor. Password resets preserve enrolled MFA. Changing the factor invalidates the prior factor and other sessions.

Five failed factor attempts block further attempts for 15 minutes, across new password sessions. Password-stage sessions expire after ten minutes and carry no operational permissions. Accepted codes cannot be replayed, including concurrent recovery-code requests. MFA completion rotates the session token. TOTP seeds use AES-256-GCM encryption bound to the user; recovery codes are randomly generated and stored as account-bound hashes. No seed, password or recovery code is included in audit events.

## Lost phone and all recovery codes

An active, separately authenticated administrator with both staff administration and governance-assignment authority may recover an enrolled account within the same facility. Their MFA must have completed within five minutes. They cannot recover themselves, recover a disabled account, or cross the existing governance-role boundary. A facility administrator cannot reset a system administrator.

The administrator must follow the approved identity-check procedure and supply its protected record reference, attest that the check occurred, and issue a new temporary password securely. This records a **staff-attested** identity check, not electronic government-ID verification. The operation atomically invalidates all old factors/recovery codes, revokes sessions, forces a password change and requires MFA re-enrollment—even when optional enrollment is configured. The interface provides this action in Staff access for eligible targets.

Before rollout, nominate and train at least two separately enrolled authorized administrators. If no eligible administrator can authenticate, use the approved downtime/escalation procedure; there is no password-only emergency bypass. Leadership must approve identity proofing and emergency arrangements and witness the recovery rehearsal. Software tests do not supply that approval.

## Release and key custody

Apply migration `20260924130000_workforce_mfa` with the pending remediation migrations before deploying this code. It adds UserMfa and Session.mfaVerifiedAt. Production requires MFA by default; `MFA_REQUIRED=false` explicitly disables mandatory enrollment only and makes the workforce-MFA configuration check fail. Enrolled and recovery-pending accounts remain protected. Use `MFA_REQUIRED=true` explicitly in the approved production configuration.

Enrollment keys are derived from AUTH_SECRET. Verify its strength and protected custody before enrollment. Back up that key separately under approved access controls; losing or replacing it without migrating encrypted factor seeds makes enrolled authenticators unreadable. This release does not implement automatic key rotation or a managed key service. Do not print secrets in evidence, logs or screenshots. Verify server/device time synchronization.

The original draft checkout was copied for review and remains unmodified. Do not deploy it. Freeze this remediation release, prepare a verified database backup and rollback plan, rehearse onboarding/recovery on the synthetic environment, then roll out with staff support. Do not roll back to a password-only build after enrollment as a routine recovery action.

## DHA claim boundary

The [DHA portal](https://certification.dha.go.ke/) assesses authentication and supporting evidence against application-specific claims. No Google-specific DHA approval was found. This feature supplies implementation and synthetic test evidence only. MFA_ENFORCEMENT still requires current approved operational evidence; configuring MFA does not approve its governance gate. OIDC remains optional and on hold pending real provider/callback/logout acceptance. Current staff accounts/roles remain governed in Mwein.
