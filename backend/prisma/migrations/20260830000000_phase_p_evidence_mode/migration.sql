-- Phase P evidence provenance. Existing technical evidence predates explicit mode
-- propagation and is conservatively classified as SHADOW.
CREATE TYPE "EvidenceMode" AS ENUM ('SIMULATED', 'SHADOW', 'CALIBRATED');

ALTER TABLE "AnalysisSession"
ADD COLUMN "evidenceMode" "EvidenceMode" NOT NULL DEFAULT 'SHADOW';

ALTER TABLE "EvidenceEvent"
ADD COLUMN "evidenceMode" "EvidenceMode" NOT NULL DEFAULT 'SHADOW';
