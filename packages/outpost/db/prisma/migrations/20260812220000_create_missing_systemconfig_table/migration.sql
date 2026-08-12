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
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
