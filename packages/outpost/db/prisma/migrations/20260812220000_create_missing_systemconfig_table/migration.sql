-- Repair migration: create SystemConfig where 0001_init did not.
--
-- Production has 0001_init recorded as applied in _prisma_migrations, but the
-- SystemConfig table it declares does not exist there. Prisma tracks
-- migrations by name, so `migrate deploy` reports "no pending migrations" and
-- will never create it. Every table and enum in schema.prisma except this one
-- is present, so this is the only gap.
--
-- The worker reads SystemConfig during boot (buildSyncEngine -> the persisted
-- status/priority/label mapping configs) at module scope, before the health
-- server starts listening. The read throws, the process exits, nothing ever
-- binds /health, and Railway's healthcheck reports "1/1 replicas never became
-- healthy". Production has been unable to deploy since 2026-08-07 as a result.
--
-- IF NOT EXISTS is deliberate: environments whose 0001_init did create the
-- table must no-op rather than fail. Column definitions match the SystemConfig
-- block in 0001_init exactly.
--
-- It repairs exactly one state — table absent. A SystemConfig that exists with
-- the WRONG columns is not repaired: this no-ops, gets recorded as applied, and
-- leaves the same "recorded but not effective" gap it was written to close. That
-- state is caught at deploy time by the schema-drift guard in
-- apps/worker/start.sh, which reports the missing column rather than the missing
-- table; repairing it needs an ALTER, not this file.
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
