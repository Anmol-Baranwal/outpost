ALTER TABLE "Message"
ADD COLUMN "responseState" TEXT,
ADD COLUMN "responseJobId" TEXT,
ADD COLUMN "responseError" TEXT;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_responseState_check"
CHECK (
    "responseState" IS NULL
    OR "responseState" IN ('PENDING', 'DELIVERED', 'ESCALATED')
);
