const env = require('../config/env');
const AppError = require('../lib/AppError');
const { ensureFreshToken } = require('./shopeeAuthService');
const { timestampNow, signShopPath } = require('./shopeeSignatureService');

class ShopeeApiError extends AppError {
  constructor(message, { providerCode = null, providerMessage = null, status = 502 } = {}) {
    super(message, {
      status,
      code: 'shopee_api_error',
      details: { providerCode },
    });
    this.providerCode = providerCode;
    this.providerMessage = providerMessage;
  }
}

async function callStoreEndpoint(store, path, query = {}) {
  const config = env.requireShopee();
  const fresh = await ensureFreshToken(store);
  const timestamp = timestampNow();
  const sign = signShopPath({
    ...config,
    path,
    timestamp,
    accessToken: fresh.accessToken,
    shopId: fresh.store.shopId,
  });
  const params = new URLSearchParams({
    partner_id: String(config.partnerId),
    timestamp: String(timestamp),
    access_token: fresh.accessToken,
    shop_id: fresh.store.shopId,
    sign,
  });
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });

  let response;
  try {
    response = await fetch(`${config.host}${path}?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error('[shopee-api] Erro de rede', {
      path,
      storeId: store.id,
      reason: error instanceof Error ? error.message : 'network_error',
    });
    throw new ShopeeApiError('A Shopee está temporariamente indisponível', {
      providerMessage: error instanceof Error ? error.message : 'network_error',
    });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    console.error('[shopee-api] Falha do provedor', {
      path,
      storeId: store.id,
      shopId: store.shopId,
      status: response.status,
      providerCode: payload?.error ?? null,
      providerMessage: payload?.message ?? null,
      requestId: payload?.request_id ?? null,
    });
    throw new ShopeeApiError('A Shopee recusou a consulta', {
      providerCode: payload?.error ?? null,
      providerMessage: payload?.message ?? null,
      status: response.status >= 400 && response.status < 500 ? 409 : 502,
    });
  }
  return payload;
}

function getItemList(store, { offset, pageSize }) {
  return callStoreEndpoint(store, '/api/v2/product/get_item_list', {
    offset,
    page_size: pageSize,
    item_status: 'NORMAL',
  });
}

function getItemBaseInfo(store, itemIds) {
  return callStoreEndpoint(store, '/api/v2/product/get_item_base_info', {
    item_id_list: itemIds.join(','),
  });
}

function getItemExtraInfo(store, itemIds) {
  return callStoreEndpoint(store, '/api/v2/product/get_item_extra_info', {
    item_id_list: itemIds.join(','),
  });
}

function getCategories(store) {
  return callStoreEndpoint(store, '/api/v2/product/get_category', {
    language: 'pt-BR',
  });
}

module.exports = {
  ShopeeApiError,
  callStoreEndpoint,
  getItemList,
  getItemBaseInfo,
  getItemExtraInfo,
  getCategories,
};
