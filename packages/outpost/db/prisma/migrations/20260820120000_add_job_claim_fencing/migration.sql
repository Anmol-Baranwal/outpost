-- Fences writes to the worker execution that owns a claim, and records the
-- deadline that execution was granted so reclaim has a single authority.
--
-- Additive and nullable with no backfill, which is deliberate: a NULL claimToken
-- on an in-flight row means "claimed before this deployed", and the reclaim's
-- legacy branch handles those on an absolute ceiling instead of a granted
-- deadline. Must deploy ahead of the code; it is a no-op for the running fleet.
ALTER TABLE "Job"
ADD COLUMN "claimToken" TEXT,
ADD COLUMN "lockUntil" TIMESTAMP(3);

-- Reclaim runs `status = 'PROCESSING' AND "lockUntil" < ?` every poll interval on
-- every replica. Not CONCURRENTLY: Prisma applies each migration inside a
-- transaction, which forbids it. The build is short anyway — Job is small enough
-- today that the brief ACCESS EXCLUSIVE lock is cheaper than the operational
-- cost of a hand-run out-of-band index.
CREATE INDEX "Job_status_lockUntil_idx" ON "Job"("status", "lockUntil");
