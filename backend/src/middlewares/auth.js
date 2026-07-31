const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../lib/AppError');

/**
 * Exige um Bearer token válido. Popula req.user = { id, email }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError('Token de autenticação ausente', {
      status: 401,
      code: 'unauthorized',
    }));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return next(new AppError(expired ? 'Token expirado' : 'Token inválido', {
      status: 401,
      code: expired ? 'token_expired' : 'invalid_token',
    }));
  }
}

module.exports = { requireAuth };
