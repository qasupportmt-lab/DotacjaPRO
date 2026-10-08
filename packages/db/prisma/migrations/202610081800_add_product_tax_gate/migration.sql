ALTER TABLE "CommerceProduct"
  ADD COLUMN "supplyModel" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN "taxClassificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "vatRateBps" INTEGER,
  ADD COLUMN "taxClassificationRef" TEXT,
  ADD COLUMN "taxReviewedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryContractVersion" TEXT;

ALTER TABLE "CommerceOrder"
  ADD COLUMN "amountNetGrosz" INTEGER,
  ADD COLUMN "amountVatGrosz" INTEGER,
  ADD COLUMN "vatRateBps" INTEGER,
  ADD COLUMN "taxClassificationRef" TEXT,
  ADD COLUMN "taxClassificationStatus" TEXT,
  ADD COLUMN "supplyModel" TEXT,
  ADD COLUMN "deliveryContractVersion" TEXT;

CREATE INDEX "CommerceProduct_taxClassificationStatus_active_idx"
ON "CommerceProduct"("taxClassificationStatus", "active");
