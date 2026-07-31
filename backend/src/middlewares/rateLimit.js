const { rateLimit } = require('express-rate-limit');

function limitResponse(message) {
  return (_req, res) => res.status(429).json({
    error: message,
    code: 'rate_limited',
  });
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: limitResponse('Muitas tentativas. Aguarde alguns minutos e tente novamente.'),
});

const actionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: limitResponse('Muitas solicitações. Aguarde um momento e tente novamente.'),
});

module.exports = { authRateLimit, actionRateLimit };
