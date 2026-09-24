# Paperless clinic release preparation

Host remains Vercel, using the existing mwein-hmis-platform project and Neon database.

A retained provider recovery branch was created before migration: pre-paperless-release-20260925, ID br-fragrant-brook-au1ljtww, parent main (br-calm-night-auqcrsjo), project restless-shadow-00344753. Neon console verified successful creation, expiry Never, 2026-09-25 01:18:53 Nairobi. The database region is AWS US East 1 (N. Virginia), with six hours of history. This recovery point is not an independent encrypted SSD backup or restore drill; those operational evidence requirements remain outstanding.

Application rollback: promote the prior deployment dpl_ECihvPauEWwG7fGjvEnatfu5di3s (source 83fdd6133c024ce057ef87d12bef4e7577635b84). The new table is additive; retain it and any signed documents after application rollback. Do not restore a full old database over later clinical writes without a separate reconciled recovery decision.

Release execution and verification will be recorded after completion. DHA readiness is not implied by this release.
