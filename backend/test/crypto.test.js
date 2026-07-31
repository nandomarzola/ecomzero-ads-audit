const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TOKEN_ENCRYPTION_KEY = '11'.repeat(32);
const { encrypt, decrypt, PREFIX } = require('../src/services/shopeeCryptoService');

test('tokens Shopee usam AES-GCM, prefixo enc:v1 e round-trip', () => {
  const first = encrypt('access-token-secreto');
  const second = encrypt('access-token-secreto');
  assert.ok(first.startsWith(PREFIX));
  assert.notEqual(first, second);
  assert.equal(decrypt(first), 'access-token-secreto');
});

test('decrypt rejeita texto puro e ciphertext adulterado', () => {
  assert.throws(() => decrypt('token-em-texto-puro'), /enc:v1/);
  const encrypted = encrypt('refresh-token');
  const tampered = `${encrypted.slice(0, -2)}00`;
  assert.throws(() => decrypt(tampered));
});
