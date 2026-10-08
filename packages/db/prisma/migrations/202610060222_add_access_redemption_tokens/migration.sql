CREATE TABLE "AccessRedemptionToken" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "purpose" TEXT NOT NULL DEFAULT 'PRODUCT_ACCESS',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "AccessRedemptionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccessRedemptionToken_tokenHash_key"
ON "AccessRedemptionToken"("tokenHash");

CREATE INDEX "AccessRedemptionToken_entitlementId_status_idx"
ON "AccessRedemptionToken"("entitlementId", "status");

CREATE INDEX "AccessRedemptionToken_expiresAt_status_idx"
ON "AccessRedemptionToken"("expiresAt", "status");

ALTER TABLE "AccessRedemptionToken"
ADD CONSTRAINT "AccessRedemptionToken_entitlementId_fkey"
FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessRedemptionToken" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AccessRedemptionToken" FROM anon, authenticated;
