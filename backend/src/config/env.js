require('dotenv').config();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} precisa ser um inteiro positivo`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes');
}

const frontendUrl = process.env.FRONTEND_URL?.trim() || 'http://localhost:5174';
const corsOrigins = (process.env.CORS_ORIGINS ?? frontendUrl)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: positiveInteger('PORT', 4000),
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: '7d',
  frontendUrl,
  corsOrigins,
  oauthCookieName: 'ads_audit_shopee_oauth',
  workersEnabled: process.env.WORKERS_ENABLED !== 'false',
  redisUrl: process.env.REDIS_URL,
  shopee: {
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
    host: process.env.SHOPEE_HOST ?? 'https://partner.shopeemobile.com',
    redirectUrl: process.env.SHOPEE_REDIRECT_URL,
    listPageSize: positiveInteger('SHOPEE_LIST_PAGE_SIZE', 100),
    itemBatchSize: positiveInteger('SHOPEE_ITEM_BATCH_SIZE', 50),
    syncTransactionTimeoutMs: positiveInteger('SHOPEE_SYNC_TRANSACTION_TIMEOUT_MS', 120_000),
    rawPayloadLogEnabled: process.env.SHOPEE_RAW_PAYLOAD_LOG_ENABLED === 'true',
    rawPayloadLogPath: process.env.SHOPEE_RAW_PAYLOAD_LOG_PATH,
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    host: process.env.ANTHROPIC_HOST ?? 'https://api.anthropic.com',
    workerConcurrency: positiveInteger('ANTHROPIC_WORKER_CONCURRENCY', 3),
    requestsPerMinute: positiveInteger('ANTHROPIC_REQUESTS_PER_MINUTE', 50),
  },
};

if (env.isProduction && env.shopee.rawPayloadLogEnabled) {
  throw new Error('SHOPEE_RAW_PAYLOAD_LOG_ENABLED não pode ser ativado em produção');
}

env.requireRedis = () => required('REDIS_URL');
env.requireTokenEncryptionKey = () => required('TOKEN_ENCRYPTION_KEY');
env.requireShopee = () => {
  const redirectUrl = required('SHOPEE_REDIRECT_URL');
  if (/<|>|definir-depois/i.test(redirectUrl)) {
    throw new Error('SHOPEE_REDIRECT_URL ainda está com valor placeholder');
  }
  try {
    new URL(redirectUrl);
  } catch {
    throw new Error('SHOPEE_REDIRECT_URL precisa ser uma URL válida');
  }
  return {
    ...env.shopee,
    partnerId: positiveInteger('SHOPEE_PARTNER_ID'),
    partnerKey: required('SHOPEE_PARTNER_KEY'),
    redirectUrl,
  };
};
env.requireAnthropic = () => ({
  ...env.anthropic,
  apiKey: required('ANTHROPIC_API_KEY'),
});

module.exports = env;
