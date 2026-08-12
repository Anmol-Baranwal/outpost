-- Postmark retries carry the same MessageID. Enforce one EMAIL ticket per
-- delivery at the database boundary while leaving other platform source-key
-- policies unchanged.
CREATE UNIQUE INDEX "Ticket_email_sourceId_key"
ON "Ticket"("sourceId")
WHERE "source" = 'EMAIL' AND "sourceId" IS NOT NULL;
