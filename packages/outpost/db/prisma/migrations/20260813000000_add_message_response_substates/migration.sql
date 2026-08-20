-- Move the two PENDING sub-states of a primary AI response out of the free-text
-- responseError column, which an operations surface reads as "what went wrong".
--
-- Purely additive: both columns are new, deliveryConfirmed carries a DEFAULT so
-- existing rows are correct without a backfill (no historical row was ever
-- delivery-confirmed), and escalationRequiredReason is NULL for every existing
-- row, which is exactly "no escalation is owed". No unique index is created.
ALTER TABLE "Message"
ADD COLUMN "deliveryConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "escalationRequiredReason" TEXT;
