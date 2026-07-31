const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const env = require('../config/env');
const prisma = require('../lib/prisma');
const AppError = require('../lib/AppError');
const { encrypt, decrypt } = require('./shopeeCryptoService');
const { timestampNow, signPublicPath } = require('./shopeeSignatureService');

const AUTHORIZE_PATH = '/api/v2/shop/auth_partner';
const TOKEN_PATH = '/api/v2/auth/token/get';
const REFRESH_PATH = '/api/v2/auth/access_token/get';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const refreshPromises = new Map();

function normalizeShopId(value) {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new AppError('shop_id inválido', { status: 422, code: 'invalid_shop_id' });
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError('shop_id inválido', { status: 422, code: 'invalid_shop_id' });
  }
  return String(parsed);
}

function storeTakenError() {
  return new AppError('Esta loja Shopee já está vinculada a outra conta', {
    status: 409,
    code: 'shopee_store_taken',
  });
}

function shopeeConfig() {
  return env.requireShopee();
}

function buildAuthorizeUrl() {
  const config = shopeeConfig();
  const timestamp = timestampNow();
  const sign = signPublicPath({ ...config, path: AUTHORIZE_PATH, timestamp });
  const params = new URLSearchParams({
    partner_id: String(config.partnerId),
    timestamp: String(timestamp),
    sign,
    redirect: config.redirectUrl,
  });
  return `${config.host}${AUTHORIZE_PATH}?${params}`;
}

function createOAuthState(userId) {
  return jwt.sign(
    { sub: userId, purpose: 'shopee_oauth', nonce: randomUUID() },
    env.jwtSecret,
    { expiresIn: '10m', algorithm: 'HS256' },
  );
}

function verifyOAuthState(token) {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (payload.purpose !== 'shopee_oauth' || typeof payload.sub !== 'string') throw new Error();
    return payload.sub;
  } catch {
    throw new AppError('Estado OAuth inválido ou expirado', {
      status: 401,
      code: 'invalid_oauth_state',
    });
  }
}

async function tokenRequest(path, body) {
  const config = shopeeConfig();
  const timestamp = timestampNow();
  const sign = signPublicPath({ ...config, path, timestamp });
  const params = new URLSearchParams({
    partner_id: String(config.partnerId),
    timestamp: String(timestamp),
    sign,
  });
  let response;
  try {
    response = await fetch(`${config.host}${path}?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, partner_id: config.partnerId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error('[shopee-auth] Erro de rede', {
      path,
      reason: error instanceof Error ? error.message : 'network_error',
    });
    throw new AppError('Não foi possível acessar a Shopee', {
      status: 502,
      code: 'shopee_unavailable',
    });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    console.error('[shopee-auth] Falha do provedor', {
      path,
      status: response.status,
      providerError: payload?.error ?? null,
      providerMessage: payload?.message ?? null,
      requestId: payload?.request_id ?? null,
    });
    throw new AppError('A Shopee recusou a autenticação da loja', {
      status: 502,
      code: 'shopee_auth_failed',
      details: { providerCode: payload?.error ?? null },
    });
  }
  return payload;
}

function validatedTokenPayload(payload) {
  const accessToken = payload?.access_token;
  const refreshToken = payload?.refresh_token;
  const expiresIn = Number(payload?.expire_in);
  if (typeof accessToken !== 'string'
    || accessToken.length === 0
    || typeof refreshToken !== 'string'
    || refreshToken.length === 0
    || !Number.isSafeInteger(expiresIn)
    || expiresIn <= 0) {
    throw new AppError('Resposta de token inesperada da Shopee', {
      status: 502,
      code: 'invalid_shopee_token_response',
    });
  }
  return { accessToken, refreshToken, expiresIn };
}

async function exchangeAuthorizationCode({ code, shopId }) {
  const config = shopeeConfig();
  const normalizedShopId = normalizeShopId(shopId);
  const payload = await tokenRequest(TOKEN_PATH, {
    code,
    shop_id: Number(normalizedShopId),
    partner_id: config.partnerId,
  });
  return validatedTokenPayload(payload);
}

async function saveConnectedStore({ userId, shopId, tokens }) {
  const normalizedShopId = normalizeShopId(shopId);
  const existing = await prisma.shopeeStore.findUnique({ where: { shopId: normalizedShopId } });
  if (existing && existing.userId !== userId) {
    throw storeTakenError();
  }
  const data = {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: encrypt(tokens.refreshToken),
    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    status: 'active',
  };
  if (existing) {
    return prisma.shopeeStore.update({ where: { id: existing.id }, data });
  }
  try {
    return await prisma.shopeeStore.create({
      data: { ...data, userId, shopId: normalizedShopId },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await prisma.shopeeStore.findUnique({
      where: { shopId: normalizedShopId },
    });
    if (!concurrent || concurrent.userId !== userId) throw storeTakenError();
    return prisma.shopeeStore.update({ where: { id: concurrent.id }, data });
  }
}

async function refreshStoreToken(store) {
  const config = shopeeConfig();
  let payload;
  try {
    payload = await tokenRequest(REFRESH_PATH, {
      refresh_token: decrypt(store.refreshToken),
      shop_id: Number(store.shopId),
      partner_id: config.partnerId,
    });
  } catch (error) {
    const concurrent = await findConcurrentRefresh(store);
    if (concurrent) return concurrent;
    throw error;
  }
  const tokens = validatedTokenPayload(payload);
  const encryptedAccessToken = encrypt(tokens.accessToken);
  const encryptedRefreshToken = encrypt(tokens.refreshToken);
  const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const claimed = await prisma.shopeeStore.updateMany({
    where: { id: store.id, refreshToken: store.refreshToken },
    data: {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      status: 'active',
    },
  });
  if (claimed.count === 0) {
    const concurrent = await findConcurrentRefresh(store);
    if (concurrent) return concurrent;
    throw new AppError('O token da loja mudou durante a renovação', {
      status: 409,
      code: 'concurrent_token_refresh',
    });
  }
  return {
    store: {
      ...store,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      status: 'active',
    },
    accessToken: tokens.accessToken,
  };
}

async function findConcurrentRefresh(store) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await prisma.shopeeStore.findUnique({ where: { id: store.id } });
    if (current
      && current.refreshToken !== store.refreshToken
      && current.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return { store: current, accessToken: decrypt(current.accessToken) };
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function ensureFreshToken(store) {
  if (store.status === 'disconnected') {
    throw new AppError('A loja está desconectada', { status: 409, code: 'store_disconnected' });
  }
  if (store.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return { store, accessToken: decrypt(store.accessToken) };
  }
  if (!refreshPromises.has(store.id)) {
    refreshPromises.set(store.id, refreshStoreToken(store).finally(() => refreshPromises.delete(store.id)));
  }
  try {
    return await refreshPromises.get(store.id);
  } catch (error) {
    await prisma.shopeeStore.update({
      where: { id: store.id },
      data: { status: 'token_expired' },
    }).catch(() => undefined);
    throw error;
  }
}

module.exports = {
  buildAuthorizeUrl,
  createOAuthState,
  verifyOAuthState,
  exchangeAuthorizationCode,
  saveConnectedStore,
  ensureFreshToken,
  normalizeShopId,
  validatedTokenPayload,
};
