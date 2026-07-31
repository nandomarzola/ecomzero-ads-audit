const { z } = require('zod');
const env = require('../config/env');
const { getCookie } = require('../lib/cookies');
const shopeeAuthService = require('../services/shopeeAuthService');

const callbackSchema = z.object({
  code: z.string().min(1).max(1000),
  shop_id: z.string().regex(/^\d+$/).refine((value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0;
  }, 'shop_id inválido').transform((value) => String(Number(value))),
});
const authorizeSchema = z.object({ state: z.string().min(1).max(2000) });

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/api/shopee/callback',
  };
}

function authorizeSession(req, res, next) {
  try {
    shopeeAuthService.buildAuthorizeUrl();
    const state = shopeeAuthService.createOAuthState(req.user.id);
    res.json({ state });
  } catch (error) {
    next(error);
  }
}

function authorize(req, res, next) {
  try {
    const { state } = authorizeSchema.parse(req.query);
    shopeeAuthService.verifyOAuthState(state);
    const authorizationUrl = shopeeAuthService.buildAuthorizeUrl();
    res.cookie(env.oauthCookieName, state, {
      ...cookieOptions(),
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(302, authorizationUrl);
  } catch (error) {
    next(error);
  }
}

async function callback(req, res, next) {
  try {
    const data = callbackSchema.parse(req.query);
    const state = getCookie(req, env.oauthCookieName);
    const userId = shopeeAuthService.verifyOAuthState(state);
    const tokens = await shopeeAuthService.exchangeAuthorizationCode({
      code: data.code,
      shopId: data.shop_id,
    });
    await shopeeAuthService.saveConnectedStore({
      userId,
      shopId: data.shop_id,
      tokens,
    });
    res.clearCookie(env.oauthCookieName, cookieOptions());
    res.redirect(302, `${env.frontendUrl}/?shopee=connected`);
  } catch (error) {
    res.clearCookie(env.oauthCookieName, cookieOptions());
    next(error);
  }
}

module.exports = { authorizeSession, authorize, callback };
