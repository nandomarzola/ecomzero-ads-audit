const { z } = require('zod');
const storeService = require('../services/storeService');
const auditRunService = require('../services/auditRunService');
const itemService = require('../services/itemService');

const idSchema = z.string().min(1).max(100);
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

async function list(req, res, next) {
  try {
    res.json({ stores: await storeService.listStores(req.user.id) });
  } catch (error) {
    next(error);
  }
}

async function sync(req, res, next) {
  try {
    const storeId = idSchema.parse(req.params.id);
    res.status(202).json(await storeService.enqueueSync(storeId, req.user.id));
  } catch (error) {
    next(error);
  }
}

async function syncStatus(req, res, next) {
  try {
    const storeId = idSchema.parse(req.params.id);
    res.json(await storeService.syncStatus(storeId, req.user.id));
  } catch (error) {
    next(error);
  }
}

async function audit(req, res, next) {
  try {
    const storeId = idSchema.parse(req.params.id);
    res.status(202).json(await auditRunService.enqueueAudit(storeId, req.user.id));
  } catch (error) {
    next(error);
  }
}

async function auditStatus(req, res, next) {
  try {
    const storeId = idSchema.parse(req.params.id);
    const auditRunId = idSchema.parse(req.query.runId);
    res.json(await auditRunService.auditStatus(storeId, req.user.id, auditRunId));
  } catch (error) {
    next(error);
  }
}

async function items(req, res, next) {
  try {
    const storeId = idSchema.parse(req.params.id);
    const pagination = paginationSchema.parse(req.query);
    res.json(await itemService.listStoreItems(storeId, req.user.id, pagination));
  } catch (error) {
    next(error);
  }
}

module.exports = { list, sync, syncStatus, audit, auditStatus, items };
