const { Router } = require('express');
const shopeeController = require('../controllers/shopee.controller');
const { requireAuth } = require('../middlewares/auth');
const { actionRateLimit } = require('../middlewares/rateLimit');

const router = Router();

router.post('/shopee/authorize-session', requireAuth, actionRateLimit, shopeeController.authorizeSession);
router.get('/shopee/authorize', shopeeController.authorize);
router.get('/shopee/callback', shopeeController.callback);

module.exports = router;
