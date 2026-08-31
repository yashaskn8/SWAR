ALTER TYPE "InterventionType" ADD VALUE 'SUPERVISOR_ESCALATION';

ALTER TABLE "EvidenceEvent"
  ADD COLUMN "participantIdentity" VARCHAR(160),
  ADD COLUMN "trackSid" VARCHAR(128),
  ADD COLUMN "windowId" VARCHAR(200),
  ADD COLUMN "correlationId" VARCHAR(128),
  ADD COLUMN "capturedAt" TIMESTAMPTZ(6),
  ADD COLUMN "inferenceStartedAt" TIMESTAMPTZ(6),
  ADD COLUMN "inferenceCompletedAt" TIMESTAMPTZ(6);

ALTER TABLE "Intervention"
  ADD COLUMN "executionLeaseId" UUID,
  ADD COLUMN "executionLeaseExpiresAt" TIMESTAMPTZ(6),
  ADD COLUMN "deadLetteredAt" TIMESTAMPTZ(6);

CREATE INDEX "EvidenceEvent_organizationId_analysisSessionId_windowId_idx"
  ON "EvidenceEvent"("organizationId", "analysisSessionId", "windowId");

CREATE INDEX "Intervention_status_executionLeaseExpiresAt_nextAttemptAt_idx"
  ON "Intervention"("status", "executionLeaseExpiresAt", "nextAttemptAt");

ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_lineage_timestamp_order_check"
  CHECK (
    ("capturedAt" IS NULL OR "inferenceStartedAt" IS NULL OR "capturedAt" <= "inferenceStartedAt")
    AND ("inferenceStartedAt" IS NULL OR "inferenceCompletedAt" IS NULL OR "inferenceStartedAt" <= "inferenceCompletedAt")
    AND ("inferenceCompletedAt" IS NULL OR "observedAt" >= "inferenceCompletedAt")
  );

ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_execution_lease_pair_check"
  CHECK (("executionLeaseId" IS NULL) = ("executionLeaseExpiresAt" IS NULL));

ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_dead_letter_state_check"
  CHECK ("deadLetteredAt" IS NULL OR "status" = 'FAILED');
