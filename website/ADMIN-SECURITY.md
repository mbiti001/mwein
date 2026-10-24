# Website administrator security

This applies to the PHP website inbox, content, careers and analytics dashboard. The clinical HMIS in `platform/` has its own authentication and is outside this release.

## Sign-in and sessions

Production administration uses a host-only `__Host-mwein_admin` session cookie with Secure, HttpOnly and SameSite=Strict. PHP session files are stored in `admin-sessions/` under the existing private website data directory, with owner-only directory permissions. The PHP strict session mode remains enabled and URL-based sessions are disabled. Existing sessions need a fresh sign-in after this release.

Authenticated requests require both the private PHP session and an active server-side registration tied to the password hash and MFA version. Sessions expire after 30 minutes idle or eight hours absolute. Account security → Sign-in security can revoke other sessions after password confirmation. Password changes revoke sessions; password recovery does not disable MFA. State-changing admin requests require CSRF checks and reject a mismatched Origin or cross-site fetch metadata.

Existing network and global account password-attempt limits remain. Authenticator and security-setting requests have separate network/global limits. Events record sign-in failures/successes, blocked attempts, MFA changes, recovery-code use, password changes and revocations. The log retains at most 10,000 events for at most 90 days. Raw addresses, passwords, setup keys and codes are excluded; network digests rotate monthly. This is a local security event history, not an externally immutable audit service.

## Activate two-step verification

The owner must complete this personally; it is not automatically enabled by deploying code.

1. Sign in at `/manage/login.php` using the existing website administrator account.
2. Open Account security → Two-step verification, sessions & security activity.
3. Confirm the current password and choose Set up authenticator. Enter the private setup key in an authenticator app as a time-based account (SHA-1, six digits, 30 seconds).
4. Enter the current password and authenticator code to enable it. Save all ten recovery codes immediately, separately from the phone. They are displayed once and each can be used once.
5. Sign out and confirm a new sign-in requires the password followed by an authenticator or unused recovery code. A password-only partial sign-in never authorizes administration and expires after five minutes.

Authenticator secrets are protected using AES-256-GCM with an HKDF-derived key from the existing private configuration secret; recovery codes use keyed hashes. OpenSSL is required for enrollment. Keep the existing private configuration secret stable and backed up: changing it makes the encrypted authenticator secret unreadable. No external QR-code provider or verification service receives the key.

Clock steps allow the current, previous or next 30-second period. Accepted counters cannot be replayed; a code used to enable MFA cannot immediately be reused for sign-in. Keep phone/server time accurate. Reference vectors from RFC 6238 Appendix B are tested, alongside real HTTP enrollment, sign-in, recovery-code and revocation workflows.

If the phone is unavailable, use one recovery code and reconfigure from account security. If all factors are lost, the hosting owner can use the CLI-only `tools/recover-admin-mfa.php` with the existing private configuration path and explicit `--disable-mfa` flag. It leaves the password unchanged, invalidates website sessions, and logs the recovery. For a tool installed separately from this checkout, supply the actual document root as the final argument. Never upload the tool, private configuration, database or recovery codes to the public document root. The owner must perform recovery and credential enrollment themselves.

## Live-source reconciliation and backups

The authenticated cPanel source viewer was used to compare live PHP files before editing. Current careers management, analytics/retry behavior, service enquiries, blog metadata and host redirects were preserved. Private configuration and runtime data were not imported into Git. The existing live website was archived in the hosting home directory before deployment; its archive permissions were tightened to 0600.

Before creating the additive security tables for the first time, the application makes an online SQLite backup in a private `security-backups/` directory and checks its integrity. Existing enquiries, posts, careers, ratings and configuration are retained. No HMIS migration is involved. Ordinary source rollback must not restore an old runtime database over newer submissions.

Apache access rules protect internal PHP includes, local logs/configuration fragments and retired development trees. They retain AutoSSL paths and the existing host-specific redirects. These rules must be checked on Apache/LiteSpeed: the PHP development server does not enforce `.htaccess`.

## Verification

31 website HTTP/database test groups, authenticator reference vectors, cookie-choice/form-state/deferred-content tests, 390 internal links/assets, 52 PHP syntax checks and JPEG handling checks passed locally. Production positive sign-in/MFA enrollment must be confirmed by the owner after deployment. This hardening is not a penetration-test or compliance certification.
