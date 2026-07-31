const fs = require('node:fs/promises');
const path = require('node:path');
const env = require('../config/env');

const DEFAULT_LOG_PATH = path.resolve(__dirname, '../../tmp/raw-shopee-response-log.jsonl');
let writeChain = Promise.resolve();

function rawPayloadLogPath() {
  return env.shopee.rawPayloadLogPath
    ? path.resolve(env.shopee.rawPayloadLogPath)
    : DEFAULT_LOG_PATH;
}

async function appendEntry(entry) {
  const filePath = rawPayloadLogPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function logRawShopeePayload({ endpoint, store, itemIds, payload }) {
  if (!env.shopee.rawPayloadLogEnabled) return Promise.resolve();
  const entry = {
    capturedAt: new Date().toISOString(),
    environment: 'sandbox-local',
    endpoint,
    storeId: store.id,
    shopId: store.shopId,
    itemIds,
    payload,
  };
  const pending = writeChain.catch(() => undefined).then(() => appendEntry(entry));
  writeChain = pending;
  return pending;
}

module.exports = {
  DEFAULT_LOG_PATH,
  logRawShopeePayload,
  rawPayloadLogPath,
};
