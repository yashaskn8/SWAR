-- Dependency-independent headless intervention loop.
-- DEMO and SHADOW records are explicitly non-production; production activation remains gated.
CREATE TYPE "SecurityControlMode" AS ENUM ('DEMO', 'SHADOW', 'PRODUCTION');

ALTER TABLE "RiskAssessment"
ADD COLUMN "activationBlockerCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "RiskEvent"
ADD COLUMN "riskAssessmentId" UUID,
ADD COLUMN "mode" "SecurityControlMode" NOT NULL DEFAULT 'SHADOW';

ALTER TABLE "Intervention"
ADD COLUMN "mode" "SecurityControlMode" NOT NULL DEFAULT 'SHADOW',
ADD COLUMN "executionAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(6),
ADD COLUMN "failureCode" VARCHAR(80);

ALTER TABLE "Alert"
ADD COLUMN "acknowledgedByMembershipId" UUID,
ADD COLUMN "externalEventId" VARCHAR(68),
ADD COLUMN "mode" "SecurityControlMode" NOT NULL DEFAULT 'SHADOW',
ADD COLUMN "acknowledgedAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "RiskEvent_organizationId_riskAssessmentId_key"
ON "RiskEvent"("organizationId", "riskAssessmentId");
CREATE UNIQUE INDEX "Alert_organizationId_externalEventId_key"
ON "Alert"("organizationId", "externalEventId");
CREATE INDEX "Intervention_organizationId_status_nextAttemptAt_idx"
ON "Intervention"("organizationId", "status", "nextAttemptAt");
CREATE INDEX "Alert_organizationId_callId_externalEventId_idx"
ON "Alert"("organizationId", "callId", "externalEventId");

ALTER TABLE "RiskEvent"
ADD CONSTRAINT "RiskEvent_riskAssessmentId_fkey"
FOREIGN KEY ("organizationId", "riskAssessmentId")
REFERENCES "RiskAssessment"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Alert"
ADD CONSTRAINT "Alert_organizationId_acknowledgedByMembershipId_fkey"
FOREIGN KEY ("organizationId", "acknowledgedByMembershipId")
REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
