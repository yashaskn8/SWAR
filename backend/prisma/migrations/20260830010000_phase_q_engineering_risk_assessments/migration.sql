-- Phase Q engineering-only assessment persistence.
-- Production RiskEvent/Intervention writes remain protected by application promotion gates.
CREATE TYPE "ScoreTarget" AS ENUM ('EXPECTED_SPEAKER', 'SPOOF', 'BONAFIDE', 'AUDIO_QUALITY');
CREATE TYPE "RiskAssessmentOutcome" AS ENUM ('VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL', 'INSUFFICIENT_EVIDENCE');
CREATE TYPE "RiskDecisionMode" AS ENUM ('ENGINEERING_TEST', 'SHADOW', 'CALIBRATED_BLOCKED', 'PRODUCTION_ELIGIBLE');

ALTER TABLE "ModelVersion" ADD COLUMN "scoreTarget" "ScoreTarget";

CREATE TABLE "RiskAssessment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "analysisSessionId" UUID NOT NULL,
    "riskPolicyId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "schemaVersion" VARCHAR(40) NOT NULL,
    "evidenceSetHashSha256" CHAR(64) NOT NULL,
    "evidenceMode" "EvidenceMode" NOT NULL,
    "decisionMode" "RiskDecisionMode" NOT NULL,
    "outcome" "RiskAssessmentOutcome" NOT NULL,
    "priorState" "RiskState" NOT NULL,
    "effectiveState" "RiskState" NOT NULL,
    "transitioned" BOOLEAN NOT NULL DEFAULT false,
    "productionEligible" BOOLEAN NOT NULL DEFAULT false,
    "activationSuppressed" BOOLEAN NOT NULL DEFAULT true,
    "reasonCode" VARCHAR(80) NOT NULL,
    "policyKey" VARCHAR(80) NOT NULL,
    "policyVersion" VARCHAR(40) NOT NULL,
    "thresholdVersion" VARCHAR(80) NOT NULL,
    "calibrationVersion" VARCHAR(80),
    "proposedInterventions" "InterventionType"[] DEFAULT ARRAY[]::"InterventionType"[],
    "maxWindowSequence" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskAssessmentEvidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "riskAssessmentId" UUID NOT NULL,
    "evidenceEventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskAssessmentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskAssessment_organizationId_id_key" ON "RiskAssessment"("organizationId", "id");
CREATE UNIQUE INDEX "RiskAssessment_organizationId_idempotencyKey_key" ON "RiskAssessment"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "RiskAssessment_organizationId_analysisSessionId_evidenceSetHashSha256_key" ON "RiskAssessment"("organizationId", "analysisSessionId", "evidenceSetHashSha256");
CREATE INDEX "RiskAssessment_organizationId_callId_occurredAt_idx" ON "RiskAssessment"("organizationId", "callId", "occurredAt");
CREATE INDEX "RiskAssessment_organizationId_analysisSessionId_maxWindowSequence_idx" ON "RiskAssessment"("organizationId", "analysisSessionId", "maxWindowSequence");
CREATE UNIQUE INDEX "RiskAssessmentEvidence_organizationId_id_key" ON "RiskAssessmentEvidence"("organizationId", "id");
CREATE UNIQUE INDEX "RiskAssessmentEvidence_organizationId_riskAssessmentId_evidenceEventId_key" ON "RiskAssessmentEvidence"("organizationId", "riskAssessmentId", "evidenceEventId");
CREATE INDEX "RiskAssessmentEvidence_organizationId_evidenceEventId_idx" ON "RiskAssessmentEvidence"("organizationId", "evidenceEventId");

ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_analysisSessionId_fkey" FOREIGN KEY ("organizationId", "analysisSessionId") REFERENCES "AnalysisSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organizationId_riskPolicyId_fkey" FOREIGN KEY ("organizationId", "riskPolicyId") REFERENCES "RiskPolicy"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessmentEvidence" ADD CONSTRAINT "RiskAssessmentEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessmentEvidence" ADD CONSTRAINT "RiskAssessmentEvidence_organizationId_riskAssessmentId_fkey" FOREIGN KEY ("organizationId", "riskAssessmentId") REFERENCES "RiskAssessment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAssessmentEvidence" ADD CONSTRAINT "RiskAssessmentEvidence_organizationId_evidenceEventId_fkey" FOREIGN KEY ("organizationId", "evidenceEventId") REFERENCES "EvidenceEvent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_integrity_check"
CHECK (
  "maxWindowSequence" >= 0 AND
  "evidenceSetHashSha256" ~ '^[0-9a-f]{64}$' AND
  (("productionEligible" = true AND "activationSuppressed" = false AND "decisionMode" = 'PRODUCTION_ELIGIBLE' AND "evidenceMode" = 'CALIBRATED') OR
   ("productionEligible" = false AND "activationSuppressed" = true AND "decisionMode" <> 'PRODUCTION_ELIGIBLE'))
);
