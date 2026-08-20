-- Message-level idempotency key for inbound provider deliveries (Postmark
-- MessageID today). A reply appended to an existing ticket had no dedup key at
-- all: a retried delivery duplicated the customer's message and re-ran the
-- reopen. The ID was already persisted inside `attachments.postmarkMessageId`,
-- but a jsonb path lookup is unindexed and cannot carry a unique constraint, so
-- the key gets a real column.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "sourceMessageId" TEXT;

-- Backfill from the JSON key so existing threads are protected too, and so the
-- column is a complete replacement for the jsonb path rather than a parallel
-- half-populated one.
--
-- Same duplicate-tolerance reasoning as the unique index below: nothing deduped
-- before this migration, so two messages on one ticket can already share a
-- postmarkMessageId. Only the oldest row per (ticketId, postmarkMessageId) is
-- backfilled (ties broken by id, so the winner is deterministic); later
-- duplicates keep NULL, which is distinct under the index and therefore always
-- buildable. Consequence, accepted knowingly: a redelivery of one of those
-- already-duplicated historical IDs is not deduped. Nothing is lost that was not
-- already lost, and every message written from here on is covered.
-- Re-runnable: the UPDATE is idempotent and skips rows already set.
WITH ranked AS (
    SELECT
        id,
        "attachments" ->> 'postmarkMessageId' AS provider_id,
        row_number() OVER (
            PARTITION BY "ticketId", "attachments" ->> 'postmarkMessageId'
            ORDER BY "createdAt", id
        ) AS rn
    FROM "Message"
    WHERE "attachments" ->> 'postmarkMessageId' IS NOT NULL
)
UPDATE "Message" m
SET "sourceMessageId" = r.provider_id
FROM ranked r
WHERE m.id = r.id
  AND r.rn = 1
  AND m."sourceMessageId" IS NULL;

-- Scoped to the ticket rather than global: a redelivery always resolves to the
-- same ticket (MailboxHash is an exact reference and the header path scans
-- oldest-first), while the same provider ID legitimately reaching two different
-- tickets must not be rejected. NULLs are distinct in Postgres, so every message
-- without a provider ID is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "Message_ticketId_sourceMessageId_key"
ON "Message"("ticketId", "sourceMessageId");
