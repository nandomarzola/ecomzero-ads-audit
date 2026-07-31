-- AlterTable
ALTER TABLE "AuditRun" ADD COLUMN "failedItems" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ListingItem" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ShopeeStore"
ADD COLUMN "syncError" TEXT,
ADD COLUMN "syncFinishedAt" TIMESTAMP(3),
ADD COLUMN "syncJobId" TEXT,
ADD COLUMN "syncProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "syncStartedAt" TIMESTAMP(3),
ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'idle';

-- CreateTable
CREATE TABLE "AuditRunItem" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditRunItem_auditRunId_status_idx" ON "AuditRunItem"("auditRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRunItem_auditRunId_itemId_key" ON "AuditRunItem"("auditRunId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingAudit_auditRunId_itemId_key" ON "ListingAudit"("auditRunId", "itemId");

-- AddForeignKey
ALTER TABLE "AuditRunItem" ADD CONSTRAINT "AuditRunItem_auditRunId_fkey"
FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRunItem" ADD CONSTRAINT "AuditRunItem_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "ListingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
