-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopeeStore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopeeStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopeeItemId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "categoryName" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "stock" INTEGER NOT NULL,
    "images" JSONB NOT NULL,
    "attributes" JSONB NOT NULL,
    "views" INTEGER,
    "sold" INTEGER,
    "likes" INTEGER,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingAudit" (
    "id" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "issues" JSONB NOT NULL,
    "suggestedTitle" TEXT,
    "suggestedDesc" TEXT,
    "suggestedAttrs" JSONB,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ShopeeStore_shopId_key" ON "ShopeeStore"("shopId");

-- CreateIndex
CREATE INDEX "ShopeeStore_userId_idx" ON "ShopeeStore"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingItem_storeId_shopeeItemId_key" ON "ListingItem"("storeId", "shopeeItemId");

-- CreateIndex
CREATE INDEX "AuditRun_storeId_startedAt_idx" ON "AuditRun"("storeId", "startedAt");

-- CreateIndex
CREATE INDEX "ListingAudit_itemId_createdAt_idx" ON "ListingAudit"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingAudit_auditRunId_idx" ON "ListingAudit"("auditRunId");

-- AddForeignKey
ALTER TABLE "ShopeeStore" ADD CONSTRAINT "ShopeeStore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingItem" ADD CONSTRAINT "ListingItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopeeStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRun" ADD CONSTRAINT "AuditRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopeeStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAudit" ADD CONSTRAINT "ListingAudit_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAudit" ADD CONSTRAINT "ListingAudit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ListingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
