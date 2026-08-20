-- Postmark retries carry the same MessageID. Enforce one EMAIL ticket per
-- delivery at the database boundary while leaving other platform source-key
-- policies unchanged.

-- Historical duplicates first. Nothing deduped inbound email before this index,
-- so a retried delivery could already have opened two tickets holding the same
-- sourceId. On such a database the CREATE below fails, and because
-- `prisma migrate deploy` runs under `set -eu` in the worker's start script a
-- failed migration means the worker never boots. Production and staging both
-- hold 0 EMAIL tickets today, so this migration would build cleanly there — that
-- is luck, not construction, and this statement is what makes it construction.
--
-- Non-destructive on purpose. The duplicate tickets and their messages are kept
-- and stay visible to agents; only the duplicate KEY is released. The oldest
-- ticket in each group keeps sourceId (ties broken by id, so the winner is
-- deterministic and identical on every database); the later ones have the value
-- moved into additionalInfo.duplicateEmailSourceId so the link stays
-- recoverable. Deleting rows would discard a customer's words to satisfy an
-- index. Re-runnable: once deduped, the UPDATE matches nothing.
WITH ranked AS (
    SELECT
        id,
        "sourceId" AS dup_source_id,
        row_number() OVER (PARTITION BY "sourceId" ORDER BY "createdAt", id) AS rn
    FROM "Ticket"
    WHERE "source" = 'EMAIL' AND "sourceId" IS NOT NULL
)
UPDATE "Ticket" t
SET
    "sourceId" = NULL,
    "additionalInfo" = coalesce(t."additionalInfo", '{}'::jsonb)
        || jsonb_build_object('duplicateEmailSourceId', r.dup_source_id)
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_email_sourceId_key"
ON "Ticket"("sourceId")
WHERE "source" = 'EMAIL' AND "sourceId" IS NOT NULL;
