const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const { DUMMY_PASSWORD_HASH, signToken } = require('../src/services/auth.service');

test('hash descartável do login é bcrypt válido com custo 10', async () => {
  assert.equal(bcrypt.getRounds(DUMMY_PASSWORD_HASH), 10);
  assert.equal(await bcrypt.compare('senha-inexistente', DUMMY_PASSWORD_HASH), false);
});

test('JWT de autenticação fixa algoritmo HS256', () => {
  const token = signToken({ id: 'user-1', email: 'user@example.com' });
  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'HS256');
  assert.equal(jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }).sub, 'user-1');
});
