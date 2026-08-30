-- Fence concurrent security-event dispatchers and recover claims after worker failure.
ALTER TABLE "Alert"
ADD COLUMN "dispatchLeaseId" UUID,
ADD COLUMN "dispatchLeaseExpiresAt" TIMESTAMPTZ(6);

CREATE INDEX "Alert_status_dispatchLeaseExpiresAt_nextAttemptAt_idx"
ON "Alert"("status", "dispatchLeaseExpiresAt", "nextAttemptAt");

ALTER TABLE "Alert"
ADD CONSTRAINT "Alert_dispatch_lease_pair_check"
CHECK (("dispatchLeaseId" IS NULL) = ("dispatchLeaseExpiresAt" IS NULL)) NOT VALID,
ADD CONSTRAINT "Alert_dispatch_lease_pending_check"
CHECK ("dispatchLeaseId" IS NULL OR "status" = 'PENDING') NOT VALID,
ADD CONSTRAINT "Alert_attempt_count_nonnegative_check"
CHECK ("attemptCount" >= 0) NOT VALID,
ADD CONSTRAINT "Alert_delivered_timestamp_check"
CHECK ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL) NOT VALID;
