-- Repair migration: create SystemConfig where 0001_init did not.
--
-- Production had 0001_init recorded as applied in _prisma_migrations, but the
-- SystemConfig table it declares did not exist there. Prisma tracks migrations
-- by name, so `migrate deploy` reported "no pending migrations" and would never
-- have created it. As observed on 2026-08-12, every other table and enum in
-- schema.prisma was present, so this was the only gap at that time.
--
-- The worker reads SystemConfig during boot (buildSyncEngine -> the persisted
-- status/priority/label mapping configs) at module scope, before the health
-- server starts listening. The read threw, the process exited, nothing bound
-- /health, and Railway's healthcheck reported "1/1 replicas never became
-- healthy". Production could not deploy from 2026-08-07 to 2026-08-12.
--
-- IF NOT EXISTS is deliberate: environments whose 0001_init did create the
-- table must no-op rather than fail. Column definitions match the SystemConfig
-- block in 0001_init exactly.
--
-- It repairs exactly one state — table absent. A SystemConfig that exists with
-- the WRONG columns is not repaired: this no-ops, gets recorded as applied, and
-- leaves the same "recorded but not effective" gap it was written to close.
-- The schema-drift guard in apps/worker/start.sh fails the deploy on any
-- difference, so that state is detected there rather than here; repairing it
-- needs an ALTER, not this file.
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
