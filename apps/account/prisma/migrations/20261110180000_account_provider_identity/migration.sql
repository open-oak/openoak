-- Current Better Auth uses providerId + accountId. Keep the old issuer field
-- and index for rolling compatibility; credentials are the only enabled login
-- provider. New credential accounts need a value when the adapter omits issuer.
ALTER TABLE "Account" ALTER COLUMN "issuer" SET DEFAULT 'local:credential';
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
