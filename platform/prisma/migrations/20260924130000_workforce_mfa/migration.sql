ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
CREATE TABLE "UserMfa" (
  "userId" UUID NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recoveryRequired" BOOLEAN NOT NULL DEFAULT false,
  "secretCiphertext" TEXT,
  "pendingCiphertext" TEXT,
  "pendingSessionId" UUID,
  "pendingExpiresAt" TIMESTAMP(3),
  "enabledAt" TIMESTAMP(3),
  "lastUsedStep" INTEGER,
  "recoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "attemptWindowAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3)
);
