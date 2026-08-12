-- Add a nullable idempotency slot rather than constraining historical BOT
-- messages. PostgreSQL permits multiple NULLs in a unique index, so existing
-- rows remain valid while new primary AI responses claim one slot per ticket.
ALTER TABLE "Message" ADD COLUMN "responseKey" TEXT;

CREATE UNIQUE INDEX "Message_ticketId_responseKey_key"
ON "Message"("ticketId", "responseKey");
