const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOAuthState,
  normalizeShopId,
  verifyOAuthState,
  validatedTokenPayload,
} = require('../src/services/shopeeAuthService');

test('estado OAuth vincula usuário e expira via JWT assinado', () => {
  const state = createOAuthState('user-123');
  assert.equal(verifyOAuthState(state), 'user-123');
  assert.throws(() => verifyOAuthState(`${state}x`), /OAuth inválido/);
});

test('resposta de token exige access, refresh e expiração', () => {
  assert.deepEqual(validatedTokenPayload({
    access_token: 'access',
    refresh_token: 'refresh',
    expire_in: 14400,
  }), { accessToken: 'access', refreshToken: 'refresh', expiresIn: 14400 });
  assert.throws(() => validatedTokenPayload({ access_token: 'access' }), /inesperada/);
  assert.throws(() => validatedTokenPayload({
    access_token: '',
    refresh_token: 'refresh',
    expire_in: 14400,
  }), /inesperada/);
  assert.throws(() => validatedTokenPayload({
    access_token: 'access',
    refresh_token: 'refresh',
    expire_in: 1.5,
  }), /inesperada/);
});

test('shop_id é canônico e não permite contornar unicidade com zeros à esquerda', () => {
  assert.equal(normalizeShopId('000611286890'), '611286890');
  assert.throws(() => normalizeShopId('611x'), /shop_id inválido/);
  assert.throws(() => normalizeShopId('0'), /shop_id inválido/);
  assert.throws(() => normalizeShopId(String(Number.MAX_SAFE_INTEGER + 1)), /shop_id inválido/);
});
