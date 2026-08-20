CREATE TYPE "MessageResponseState" AS ENUM ('PENDING', 'DELIVERED', 'ESCALATED');

ALTER TABLE "Message"
ADD COLUMN "responseState" "MessageResponseState",
ADD COLUMN "responseJobId" TEXT,
ADD COLUMN "responseError" TEXT;
