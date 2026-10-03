-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "telegramFirstName" TEXT,
    "telegramLastName" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'pl',
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voivodeship" TEXT,
    "county" TEXT,
    "municipality" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "pupOfficeId" TEXT,
    "wupOfficeId" TEXT,
    "lgdId" TEXT,
    "regionVerified" BOOLEAN NOT NULL DEFAULT false,
    "regionSource" TEXT,
    "terytMunicipalityCode" TEXT,
    "terytLocalityCode" TEXT,
    "terytVerified" BOOLEAN NOT NULL DEFAULT false,
    "terytVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employmentStatus" TEXT,
    "wantsToStartBusiness" BOOLEAN,
    "existingBusinessLegalForm" TEXT,
    "plannedLegalForm" TEXT,
    "plannedBusinessDescription" TEXT,
    "plannedPkd" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessActiveLast12Months" BOOLEAN,
    "priorNonRepayableStartupAid" BOOLEAN,
    "wantsPfronPath" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "morningDigest" BOOLEAN NOT NULL DEFAULT true,
    "criticalAlerts" BOOLEAN NOT NULL DEFAULT true,
    "newCalls" BOOLEAN NOT NULL DEFAULT true,
    "legalChanges" BOOLEAN NOT NULL DEFAULT true,
    "caseChanges" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "telegramWriteAccess" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voivodeship" TEXT,
    "county" TEXT,
    "municipality" TEXT,
    "officialUrl" TEXT NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionAssignment" (
    "id" TEXT NOT NULL,
    "voivodeship" TEXT NOT NULL,
    "county" TEXT,
    "municipality" TEXT,
    "city" TEXT,
    "postalCodeFrom" TEXT,
    "postalCodeTo" TEXT,
    "institutionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT,
    "kind" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "displayName" TEXT,
    "discoveredFromUrl" TEXT,
    "trustLevel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastStatusCode" INTEGER,
    "scopeVoivodeship" TEXT,
    "scopeCounty" TEXT,
    "scopeMunicipality" TEXT,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialFormTemplate" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "institutionId" TEXT,
    "programCode" TEXT,
    "formCode" TEXT NOT NULL,
    "versionLabel" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "officialOnly" BOOLEAN NOT NULL DEFAULT true,
    "requiredForPackage" BOOLEAN NOT NULL DEFAULT true,
    "mappingStatus" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "mappingVerifiedAt" TIMESTAMP(3),
    "mappingAnalyzedAt" TIMESTAMP(3),
    "mappingAnalysisJson" JSONB,
    "mappingAnalysisError" TEXT,
    "mappingVersion" INTEGER NOT NULL DEFAULT 1,
    "fundingCallId" TEXT,

    CONSTRAINT "OfficialFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormFieldMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "locatorType" TEXT NOT NULL,
    "locatorJson" JSONB,
    "inputType" TEXT NOT NULL,
    "questionLabel" TEXT,
    "section" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "helpText" TEXT,
    "validationJson" JSONB,

    CONSTRAINT "FormFieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingCall" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "programCode" TEXT,
    "status" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "untilExhausted" BOOLEAN NOT NULL DEFAULT false,
    "officialUrl" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "evidenceJson" JSONB,
    "sourceHash" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "FundingCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "fundingCallId" TEXT,
    "legalSnapshotId" TEXT,
    "formTemplateId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAnswer" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CaseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "storageKey" TEXT NOT NULL,
    "officialSource" BOOLEAN NOT NULL DEFAULT false,
    "templateHash" TEXT,
    "sourceDocumentId" TEXT,
    "renderJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "changeType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationScore" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "requalificationProcessedAt" TIMESTAMP(3),
    "payload" JSONB,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "changeEventId" TEXT,
    "dedupeKey" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRenderJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "outputStorageKey" TEXT,
    "outputSha256" TEXT,
    "outputMimeType" TEXT,
    "outputName" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerytMunicipality" (
    "id" TEXT NOT NULL,
    "tercCode" TEXT NOT NULL,
    "voivodeshipCode" TEXT NOT NULL,
    "voivodeship" TEXT NOT NULL,
    "countyCode" TEXT,
    "county" TEXT,
    "municipalityCode" TEXT,
    "municipality" TEXT NOT NULL,
    "municipalityTypeCode" TEXT,
    "municipalityType" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "sourceKind" TEXT NOT NULL DEFAULT 'TERYT_WS1',
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceVersion" TEXT,

    CONSTRAINT "TerytMunicipality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerytLocality" (
    "id" TEXT NOT NULL,
    "simcCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localityType" TEXT,
    "municipalityTercCode" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceVersion" TEXT,

    CONSTRAINT "TerytLocality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationSnapshot" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalCriterionSet" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fundingCallId" TEXT,
    "sourceDocumentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "minimumPoints" DOUBLE PRECISION,
    "maximumPoints" DOUBLE PRECISION,
    "blockingRulesJson" JSONB,
    "analysisJson" JSONB,
    "sourceHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "analyzedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalCriterionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalCriterion" (
    "id" TEXT NOT NULL,
    "criterionSetId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "maxPoints" DOUBLE PRECISION,
    "failIfZero" BOOLEAN NOT NULL DEFAULT false,
    "scoringJson" JSONB,
    "evidenceHint" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocalCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionAssessmentSnapshot" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "criterionSetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionAssessmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionInstructionVersion" (
    "id" TEXT NOT NULL,
    "fundingCallId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "instructionJson" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceHash" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionInstructionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPackageJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "submissionInstructionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "recipientEmail" TEXT NOT NULL,
    "outputStorageKey" TEXT,
    "outputSha256" TEXT,
    "outputName" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentPackageJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingProfile_userId_key" ON "FundingProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_code_key" ON "Institution"("code");

-- CreateIndex
CREATE INDEX "RegionAssignment_voivodeship_county_municipality_city_idx" ON "RegionAssignment"("voivodeship", "county", "municipality", "city");

-- CreateIndex
CREATE UNIQUE INDEX "RegionAssignment_institutionId_role_voivodeship_municipalit_key" ON "RegionAssignment"("institutionId", "role", "voivodeship", "municipality");

-- CreateIndex
CREATE UNIQUE INDEX "Source_canonicalUrl_key" ON "Source"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sourceId_sha256_key" ON "SourceDocument"("sourceId", "sha256");

-- CreateIndex
CREATE INDEX "OfficialFormTemplate_institutionId_programCode_active_idx" ON "OfficialFormTemplate"("institutionId", "programCode", "active");

-- CreateIndex
CREATE INDEX "OfficialFormTemplate_fundingCallId_active_idx" ON "OfficialFormTemplate"("fundingCallId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FormFieldMapping_templateId_fieldKey_key" ON "FormFieldMapping"("templateId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "FundingCall_sourceId_key" ON "FundingCall"("sourceId");

-- CreateIndex
CREATE INDEX "FundingCall_status_opensAt_closesAt_idx" ON "FundingCall"("status", "opensAt", "closesAt");

-- CreateIndex
CREATE INDEX "FundingCall_verificationStatus_verifiedAt_idx" ON "FundingCall"("verificationStatus", "verifiedAt");

-- CreateIndex
CREATE INDEX "Case_userId_status_idx" ON "Case"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CaseAnswer_caseId_fieldKey_version_key" ON "CaseAnswer"("caseId", "fieldKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocument_renderJobId_key" ON "CaseDocument"("renderJobId");

-- CreateIndex
CREATE INDEX "ChangeEvent_severity_verified_detectedAt_idx" ON "ChangeEvent"("severity", "verified", "detectedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_scheduledAt_sentAt_idx" ON "Notification"("userId", "scheduledAt", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_entityId_createdAt_idx" ON "AuditEvent"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_email_createdAt_idx" ON "EmailVerification"("userId", "email", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRenderJob_status_requestedAt_idx" ON "DocumentRenderJob"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "DocumentRenderJob_caseId_templateId_idx" ON "DocumentRenderJob"("caseId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TerytMunicipality_tercCode_key" ON "TerytMunicipality"("tercCode");

-- CreateIndex
CREATE INDEX "TerytMunicipality_voivodeship_municipality_idx" ON "TerytMunicipality"("voivodeship", "municipality");

-- CreateIndex
CREATE INDEX "TerytMunicipality_county_municipality_idx" ON "TerytMunicipality"("county", "municipality");

-- CreateIndex
CREATE UNIQUE INDEX "TerytLocality_simcCode_key" ON "TerytLocality"("simcCode");

-- CreateIndex
CREATE INDEX "TerytLocality_name_municipalityTercCode_idx" ON "TerytLocality"("name", "municipalityTercCode");

-- CreateIndex
CREATE INDEX "QualificationSnapshot_caseId_createdAt_idx" ON "QualificationSnapshot"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalCriterionSet_sourceDocumentId_key" ON "LocalCriterionSet"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "LocalCriterionSet_institutionId_status_verifiedAt_idx" ON "LocalCriterionSet"("institutionId", "status", "verifiedAt");

-- CreateIndex
CREATE INDEX "LocalCriterionSet_fundingCallId_status_idx" ON "LocalCriterionSet"("fundingCallId", "status");

-- CreateIndex
CREATE INDEX "LocalCriterion_criterionSetId_sortOrder_idx" ON "LocalCriterion"("criterionSetId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LocalCriterion_criterionSetId_code_key" ON "LocalCriterion"("criterionSetId", "code");

-- CreateIndex
CREATE INDEX "CriterionAssessmentSnapshot_caseId_createdAt_idx" ON "CriterionAssessmentSnapshot"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CriterionAssessmentSnapshot_criterionSetId_createdAt_idx" ON "CriterionAssessmentSnapshot"("criterionSetId", "createdAt");

-- CreateIndex
CREATE INDEX "SubmissionInstructionVersion_fundingCallId_status_verifiedA_idx" ON "SubmissionInstructionVersion"("fundingCallId", "status", "verifiedAt");

-- CreateIndex
CREATE INDEX "DocumentPackageJob_status_requestedAt_idx" ON "DocumentPackageJob"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "DocumentPackageJob_caseId_requestedAt_idx" ON "DocumentPackageJob"("caseId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_storageKey_key" ON "StoredObject"("storageKey");

-- CreateIndex
CREATE INDEX "StoredObject_sha256_idx" ON "StoredObject"("sha256");

-- CreateIndex
CREATE INDEX "StoredObject_createdAt_idx" ON "StoredObject"("createdAt");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingProfile" ADD CONSTRAINT "FundingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegionAssignment" ADD CONSTRAINT "RegionAssignment_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialFormTemplate" ADD CONSTRAINT "OfficialFormTemplate_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialFormTemplate" ADD CONSTRAINT "OfficialFormTemplate_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "FundingCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFieldMapping" ADD CONSTRAINT "FormFieldMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OfficialFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingCall" ADD CONSTRAINT "FundingCall_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingCall" ADD CONSTRAINT "FundingCall_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "FundingCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAnswer" ADD CONSTRAINT "CaseAnswer_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRenderJob" ADD CONSTRAINT "DocumentRenderJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRenderJob" ADD CONSTRAINT "DocumentRenderJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OfficialFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerytLocality" ADD CONSTRAINT "TerytLocality_municipalityTercCode_fkey" FOREIGN KEY ("municipalityTercCode") REFERENCES "TerytMunicipality"("tercCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationSnapshot" ADD CONSTRAINT "QualificationSnapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCriterionSet" ADD CONSTRAINT "LocalCriterionSet_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCriterionSet" ADD CONSTRAINT "LocalCriterionSet_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "FundingCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCriterionSet" ADD CONSTRAINT "LocalCriterionSet_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCriterion" ADD CONSTRAINT "LocalCriterion_criterionSetId_fkey" FOREIGN KEY ("criterionSetId") REFERENCES "LocalCriterionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionAssessmentSnapshot" ADD CONSTRAINT "CriterionAssessmentSnapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionAssessmentSnapshot" ADD CONSTRAINT "CriterionAssessmentSnapshot_criterionSetId_fkey" FOREIGN KEY ("criterionSetId") REFERENCES "LocalCriterionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionInstructionVersion" ADD CONSTRAINT "SubmissionInstructionVersion_fundingCallId_fkey" FOREIGN KEY ("fundingCallId") REFERENCES "FundingCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPackageJob" ADD CONSTRAINT "DocumentPackageJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPackageJob" ADD CONSTRAINT "DocumentPackageJob_submissionInstructionId_fkey" FOREIGN KEY ("submissionInstructionId") REFERENCES "SubmissionInstructionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

