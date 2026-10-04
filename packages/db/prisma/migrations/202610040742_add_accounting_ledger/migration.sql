CREATE TABLE "SaleTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "amountDueGrosz" INTEGER NOT NULL,
    "amountReceivedGrosz" INTEGER NOT NULL DEFAULT 0,
    "refundedGrosz" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SaleTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingExpense" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "amountGrosz" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "documentReference" TEXT,
    "deductible" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleTransaction_provider_providerTransactionId_key"
ON "SaleTransaction"("provider", "providerTransactionId");

CREATE INDEX "SaleTransaction_dueAt_status_isTest_idx"
ON "SaleTransaction"("dueAt", "status", "isTest");

CREATE INDEX "SaleTransaction_receivedAt_status_isTest_idx"
ON "SaleTransaction"("receivedAt", "status", "isTest");

CREATE INDEX "SaleTransaction_userId_idx"
ON "SaleTransaction"("userId");

CREATE INDEX "AccountingExpense_incurredAt_deductible_idx"
ON "AccountingExpense"("incurredAt", "deductible");

CREATE INDEX "AccountingExpense_createdByUserId_idx"
ON "AccountingExpense"("createdByUserId");

ALTER TABLE "SaleTransaction"
ADD CONSTRAINT "SaleTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountingExpense"
ADD CONSTRAINT "AccountingExpense_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SaleTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingExpense" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "SaleTransaction" FROM anon, authenticated;
REVOKE ALL ON TABLE "AccountingExpense" FROM anon, authenticated;
