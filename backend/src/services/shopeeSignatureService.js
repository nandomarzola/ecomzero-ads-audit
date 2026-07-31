const { createHmac } = require('node:crypto');

function timestampNow() {
  return Math.floor(Date.now() / 1000);
}

function signBaseString(baseString, partnerKey) {
  return createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function signPublicPath({ partnerId, partnerKey, path, timestamp }) {
  return signBaseString(`${partnerId}${path}${timestamp}`, partnerKey);
}

function signShopPath({ partnerId, partnerKey, path, timestamp, accessToken, shopId }) {
  return signBaseString(
    `${partnerId}${path}${timestamp}${accessToken}${shopId}`,
    partnerKey,
  );
}

module.exports = { timestampNow, signPublicPath, signShopPath };
