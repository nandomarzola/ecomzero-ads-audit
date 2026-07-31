const { z } = require('zod');
const itemService = require('../services/itemService');

const idSchema = z.string().min(1).max(100);
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

async function details(req, res, next) {
  try {
    const itemId = idSchema.parse(req.params.id);
    res.json({ item: await itemService.itemDetails(itemId, req.user.id) });
  } catch (error) {
    next(error);
  }
}

async function audits(req, res, next) {
  try {
    const itemId = idSchema.parse(req.params.id);
    const pagination = paginationSchema.parse(req.query);
    res.json(await itemService.auditHistory(itemId, req.user.id, pagination));
  } catch (error) {
    next(error);
  }
}

module.exports = { details, audits };
