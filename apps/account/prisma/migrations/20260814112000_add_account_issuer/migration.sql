-- Better Auth 1.7 identifies accounts by issuer + accountId. OpenOak Account
-- currently enables credentials only; retain a compatible fallback for any
-- legacy OAuth-provider row so this additive migration remains deployable.
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;

UPDATE "Account"
SET "issuer" = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "providerId"
END;

ALTER TABLE "Account" ALTER COLUMN "issuer" SET NOT NULL;

CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");
