const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-bytes';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.TOKEN_ENCRYPTION_KEY = '44'.repeat(32);
process.env.SHOPEE_PARTNER_ID = '2036419';
process.env.SHOPEE_PARTNER_KEY = 'test-partner-key';
process.env.SHOPEE_HOST = 'https://partner.test';
process.env.SHOPEE_REDIRECT_URL = 'https://api.test/api/shopee/callback';
process.env.FRONTEND_URL = 'https://app.test';
process.env.SHOPEE_RAW_PAYLOAD_LOG_ENABLED = 'false';

const prisma = require('../src/lib/prisma');
const controller = require('../src/controllers/shopee.controller');
const service = require('../src/services/shopeeAuthService');
const env = require('../src/config/env');
const { decrypt, encrypt } = require('../src/services/shopeeCryptoService');

function responseDouble() {
  return {
    cookies: [],
    cleared: [],
    redirects: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    clearCookie(name, options) {
      this.cleared.push({ name, options });
    },
    redirect(status, location) {
      this.redirects.push({ status, location });
    },
  };
}

test('authorize valida estado e grava cookie OAuth restrito ao callback', () => {
  const state = service.createOAuthState('user-1');
  const res = responseDouble();
  let nextError;

  controller.authorize({ query: { state } }, res, (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0].name, env.oauthCookieName);
  assert.equal(res.cookies[0].value, state);
  assert.deepEqual(res.cookies[0].options, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/shopee/callback',
    maxAge: 10 * 60 * 1000,
  });
  assert.equal(res.redirects.length, 1);
  const authorizationUrl = new URL(res.redirects[0].location);
  assert.equal(res.redirects[0].status, 302);
  assert.equal(authorizationUrl.origin, 'https://partner.test');
  assert.equal(authorizationUrl.pathname, '/api/v2/shop/auth_partner');
  assert.equal(authorizationUrl.searchParams.get('partner_id'), '2036419');
  assert.equal(authorizationUrl.searchParams.get('redirect'), process.env.SHOPEE_REDIRECT_URL);
  assert.match(authorizationUrl.searchParams.get('sign'), /^[a-f0-9]{64}$/);
});

test('callback usa usuário do cookie assinado e normaliza shop_id', async (t) => {
  const originalExchange = service.exchangeAuthorizationCode;
  const originalSave = service.saveConnectedStore;
  const calls = [];
  service.exchangeAuthorizationCode = async (input) => {
    calls.push({ type: 'exchange', input });
    return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 14400 };
  };
  service.saveConnectedStore = async (input) => {
    calls.push({ type: 'save', input });
  };
  t.after(() => {
    service.exchangeAuthorizationCode = originalExchange;
    service.saveConnectedStore = originalSave;
  });

  const state = service.createOAuthState('user-cookie');
  const req = {
    query: { code: 'authorization-code', shop_id: '000611286890' },
    headers: { cookie: `${env.oauthCookieName}=${encodeURIComponent(state)}` },
  };
  const res = responseDouble();
  let nextError;

  await controller.callback(req, res, (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.deepEqual(calls[0], {
    type: 'exchange',
    input: { code: 'authorization-code', shopId: '611286890' },
  });
  assert.equal(calls[1].type, 'save');
  assert.equal(calls[1].input.userId, 'user-cookie');
  assert.equal(calls[1].input.shopId, '611286890');
  assert.equal(res.cleared[0].name, env.oauthCookieName);
  assert.deepEqual(res.redirects[0], { status: 302, location: 'https://app.test/?shopee=connected' });
});

test('vínculo cifra tokens, preserva dono e resolve callback concorrente', async (t) => {
  const originalFindUnique = prisma.shopeeStore.findUnique;
  const originalCreate = prisma.shopeeStore.create;
  const originalUpdate = prisma.shopeeStore.update;
  const existing = { id: 'store-1', userId: 'user-1', shopId: '611286890' };
  let lookup = 0;
  let updated;
  prisma.shopeeStore.findUnique = async ({ where }) => {
    assert.equal(where.shopId, '611286890');
    lookup += 1;
    return lookup === 1 ? null : existing;
  };
  prisma.shopeeStore.create = async () => {
    const error = new Error('unique race');
    error.code = 'P2002';
    throw error;
  };
  prisma.shopeeStore.update = async ({ where, data }) => {
    updated = { where, data };
    return { ...existing, ...data };
  };
  t.after(() => {
    prisma.shopeeStore.findUnique = originalFindUnique;
    prisma.shopeeStore.create = originalCreate;
    prisma.shopeeStore.update = originalUpdate;
  });

  const saved = await service.saveConnectedStore({
    userId: 'user-1',
    shopId: '000611286890',
    tokens: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 14400 },
  });

  assert.deepEqual(updated.where, { id: 'store-1' });
  assert.equal(decrypt(updated.data.accessToken), 'new-access');
  assert.equal(decrypt(updated.data.refreshToken), 'new-refresh');
  assert.equal(updated.data.status, 'active');
  assert.match(saved.accessToken, /^enc:v1:/);
});

test('vínculo nunca atualiza loja pertencente a outro usuário', async (t) => {
  const originalFindUnique = prisma.shopeeStore.findUnique;
  prisma.shopeeStore.findUnique = async () => ({
    id: 'store-other',
    userId: 'user-other',
    shopId: '611286890',
  });
  t.after(() => { prisma.shopeeStore.findUnique = originalFindUnique; });

  await assert.rejects(
    service.saveConnectedStore({
      userId: 'user-1',
      shopId: '611286890',
      tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 14400 },
    }),
    (error) => error.code === 'shopee_store_taken' && error.status === 409,
  );
});

test('token perto de expirar renova access e refresh uma única vez', async (t) => {
  const originalFetch = global.fetch;
  const originalUpdateMany = prisma.shopeeStore.updateMany;
  const originalUpdate = prisma.shopeeStore.update;
  let fetchCount = 0;
  let persisted;
  global.fetch = async (url, options) => {
    fetchCount += 1;
    const requestUrl = new URL(url);
    assert.equal(requestUrl.pathname, '/api/v2/auth/access_token/get');
    assert.match(requestUrl.searchParams.get('sign'), /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(options.body), {
      refresh_token: 'old-refresh',
      shop_id: 611286890,
      partner_id: 2036419,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expire_in: 14400,
      }),
    };
  };
  prisma.shopeeStore.updateMany = async ({ where, data }) => {
    persisted = { where, data };
    return { count: 1 };
  };
  prisma.shopeeStore.update = async () => {
    throw new Error('não deveria marcar token_expired');
  };
  t.after(() => {
    global.fetch = originalFetch;
    prisma.shopeeStore.updateMany = originalUpdateMany;
    prisma.shopeeStore.update = originalUpdate;
  });

  const store = {
    id: 'store-refresh',
    userId: 'user-1',
    shopId: '611286890',
    accessToken: encrypt('old-access'),
    refreshToken: encrypt('old-refresh'),
    tokenExpiresAt: new Date(Date.now() + 60_000),
    status: 'active',
  };
  const [first, second] = await Promise.all([
    service.ensureFreshToken(store),
    service.ensureFreshToken(store),
  ]);

  assert.equal(fetchCount, 1);
  assert.equal(first.accessToken, 'rotated-access');
  assert.equal(second.accessToken, 'rotated-access');
  assert.equal(decrypt(persisted.data.accessToken), 'rotated-access');
  assert.equal(decrypt(persisted.data.refreshToken), 'rotated-refresh');
  assert.deepEqual(persisted.where, { id: store.id, refreshToken: store.refreshToken });
});
