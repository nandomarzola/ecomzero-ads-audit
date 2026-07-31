CREATE UNIQUE INDEX "AuditRun_one_active_per_store_key"
ON "AuditRun"("storeId")
WHERE "status" IN ('pending', 'running');
