-- Repair migration: create SystemConfig where 0001_init did not.
--
-- Production had 0001_init recorded as applied in _prisma_migrations, but the
-- SystemConfig table it declares did not exist there. Prisma tracks migrations
-- by name, so `migrate deploy` reported "no pending migrations" and would never
-- have created it.
--
-- Scope of the gap, as established on 2026-08-12: after the table was created
-- directly in production, a full `migrate diff --from-schema-datasource
-- --to-schema-datamodel` against that database reported "No difference detected".
-- That compares indexes, constraints and column types, not just tables — so
-- SystemConfig really was the only difference, and the rest of 0001_init (which
-- creates 45 indexes and 12 foreign keys AFTER this table) did land. Staging was
-- not checked; its Postgres has no public URL, and the drift guard in
-- apps/worker/start.sh is what will report the answer on its next deploy.
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
-- the WRONG columns cannot be repaired by a CREATE; that needs an ALTER, and
-- guessing the right one blind is worse than stopping.
-- Note for anyone hand-repairing this table under pressure: updatedAt is NOT NULL
-- with no DEFAULT, because @updatedAt is applied client-side by Prisma. A bare
-- `INSERT INTO "SystemConfig" (key, value) VALUES (...)` from psql will fail the
-- not-null check; pass updatedAt = now() explicitly.
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- Assert the repair actually took, rather than trusting it.
--
-- Left alone, the wrong-columns case is the failure this migration was written to
-- eliminate, reproduced one level up: CREATE ... IF NOT EXISTS no-ops, Prisma
-- records the migration as applied, and the database still does not match
-- schema.prisma — "recorded but not effective" all over again. Deferring it to the
-- worker's drift guard is not enough either, because apps/web/start.sh runs a bare
-- `migrate deploy` against this same database with no guard, so a web-first deploy
-- would close the repair window silently and leave detection to whenever the
-- worker next deploys.
--
-- Failing here instead records the migration as FAILED (P3009), which blocks both
-- services and demands a human. That is deliberately louder than the alternative:
-- a stopped deploy is recoverable, a silently-ineffective one cost nine days.
DO $$
BEGIN
    IF (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'SystemConfig'
          AND column_name IN ('key', 'value', 'updatedAt')
    ) <> 3 THEN
        RAISE EXCEPTION
            'SystemConfig exists with unexpected columns; repairing it needs an ALTER, not this migration. Compare the live table against the SystemConfig model in schema.prisma.';
    END IF;
END $$;
