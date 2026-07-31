const { Router } = require('express');
const storeController = require('../controllers/store.controller');
const { requireAuth } = require('../middlewares/auth');
const { actionRateLimit } = require('../middlewares/rateLimit');

const router = Router();

router.get('/stores', requireAuth, storeController.list);
router.post('/stores/:id/sync', requireAuth, actionRateLimit, storeController.sync);
router.get('/stores/:id/sync-status', requireAuth, storeController.syncStatus);
router.post('/stores/:id/audit', requireAuth, actionRateLimit, storeController.audit);
router.get('/stores/:id/audit-status', requireAuth, storeController.auditStatus);
router.get('/stores/:id/items', requireAuth, storeController.items);

module.exports = router;
