const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { signPublicPath, signShopPath } = require('../src/services/shopeeSignatureService');

test('assinatura pública Shopee usa partnerId + path + timestamp', () => {
  const input = { partnerId: 123, partnerKey: 'secret', path: '/api/v2/test', timestamp: 1700000000 };
  const expected = createHmac('sha256', input.partnerKey)
    .update('123/api/v2/test1700000000')
    .digest('hex');
  assert.equal(signPublicPath(input), expected);
});

test('assinatura privada inclui access token e shop id na ordem correta', () => {
  const input = {
    partnerId: 123,
    partnerKey: 'secret',
    path: '/api/v2/product/get_item_list',
    timestamp: 1700000000,
    accessToken: 'access',
    shopId: '611286890',
  };
  const expected = createHmac('sha256', input.partnerKey)
    .update('123/api/v2/product/get_item_list1700000000access611286890')
    .digest('hex');
  assert.equal(signShopPath(input), expected);
});
