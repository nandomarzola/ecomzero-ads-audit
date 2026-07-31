const { Router } = require('express');
const itemController = require('../controllers/item.controller');
const { requireAuth } = require('../middlewares/auth');

const router = Router();

router.get('/items/:id', requireAuth, itemController.details);
router.get('/items/:id/audits', requireAuth, itemController.audits);

module.exports = router;
