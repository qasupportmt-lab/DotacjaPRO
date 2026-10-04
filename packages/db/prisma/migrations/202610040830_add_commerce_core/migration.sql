CREATE TABLE "CommerceProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "priceGrossGrosz" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "deliveryType" TEXT NOT NULL DEFAULT 'DIGITAL',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommerceProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "amountGrossGrosz" INTEGER NOT NULL,
    "legalVersion" TEXT NOT NULL,
    "legalAcceptanceId" TEXT NOT NULL,
    "provider" TEXT,
    "providerCheckoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "amountReceivedGrosz" INTEGER NOT NULL DEFAULT 0,
    "refundedGrosz" INTEGER NOT NULL DEFAULT 0,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceProduct_code_key" ON "CommerceProduct"("code");
CREATE INDEX "CommerceProduct_active_code_idx" ON "CommerceProduct"("active", "code");
CREATE INDEX "CommerceOrder_userId_createdAt_idx" ON "CommerceOrder"("userId", "createdAt");
CREATE INDEX "CommerceOrder_status_createdAt_idx" ON "CommerceOrder"("status", "createdAt");
CREATE UNIQUE INDEX "CommerceOrder_provider_providerCheckoutId_key" ON "CommerceOrder"("provider", "providerCheckoutId");
CREATE UNIQUE INDEX "PaymentRecord_provider_providerPaymentId_key" ON "PaymentRecord"("provider", "providerPaymentId");
CREATE INDEX "PaymentRecord_orderId_status_idx" ON "PaymentRecord"("orderId", "status");
CREATE INDEX "PaymentRecord_receivedAt_idx" ON "PaymentRecord"("receivedAt");
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");
CREATE UNIQUE INDEX "Entitlement_userId_productId_orderId_key" ON "Entitlement"("userId", "productId", "orderId");
CREATE INDEX "Entitlement_userId_status_idx" ON "Entitlement"("userId", "status");
CREATE INDEX "Entitlement_productId_status_idx" ON "Entitlement"("productId", "status");

ALTER TABLE "CommerceOrder"
ADD CONSTRAINT "CommerceOrder_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrder"
ADD CONSTRAINT "CommerceOrder_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRecord"
ADD CONSTRAINT "PaymentRecord_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Entitlement"
ADD CONSTRAINT "Entitlement_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Entitlement"
ADD CONSTRAINT "Entitlement_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Entitlement"
ADD CONSTRAINT "Entitlement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommerceProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommerceOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Entitlement" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "CommerceProduct" FROM anon, authenticated;
REVOKE ALL ON TABLE "CommerceOrder" FROM anon, authenticated;
REVOKE ALL ON TABLE "PaymentRecord" FROM anon, authenticated;
REVOKE ALL ON TABLE "PaymentEvent" FROM anon, authenticated;
REVOKE ALL ON TABLE "Entitlement" FROM anon, authenticated;
