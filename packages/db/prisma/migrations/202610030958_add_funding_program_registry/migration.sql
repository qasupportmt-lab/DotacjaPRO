CREATE TABLE "FundingProgram" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "financingType" TEXT NOT NULL,
  "operatorInstitutionId" TEXT,
  "scope" TEXT NOT NULL,
  "scopeVoivodeships" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "applicantTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "officialUrl" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadataJson" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundingProgram_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundingProgram_code_key" ON "FundingProgram"("code");
CREATE INDEX "FundingProgram_category_active_idx" ON "FundingProgram"("category","active");
CREATE INDEX "FundingProgram_operatorInstitutionId_idx" ON "FundingProgram"("operatorInstitutionId");
CREATE INDEX "FundingProgram_verificationStatus_idx" ON "FundingProgram"("verificationStatus");

ALTER TABLE "FundingProgram"
  ADD CONSTRAINT "FundingProgram_operatorInstitutionId_fkey"
  FOREIGN KEY ("operatorInstitutionId") REFERENCES "Institution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FundingCall" ADD COLUMN "programId" TEXT;
ALTER TABLE "FundingCall"
  ADD CONSTRAINT "FundingCall_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "FundingProgram"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "FundingCall_programId_idx" ON "FundingCall"("programId");

ALTER TABLE "Case" ADD COLUMN "programId" TEXT;
ALTER TABLE "Case"
  ADD CONSTRAINT "Case_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "FundingProgram"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Case_programId_idx" ON "Case"("programId");

ALTER TABLE "public"."FundingProgram" ENABLE ROW LEVEL SECURITY;
