const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth');
const { authRateLimit } = require('../middlewares/rateLimit');

const router = Router();

router.post('/auth/register', authRateLimit, authController.register);
router.post('/auth/login', authRateLimit, authController.login);
router.post('/auth/logout', authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
