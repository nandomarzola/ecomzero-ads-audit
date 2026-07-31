const env = require('../config/env');
const prisma = require('../lib/prisma');
const AppError = require('../lib/AppError');
const shopeeApi = require('./shopeeApiService');
const { logRawShopeePayload } = require('./shopeeRawPayloadLogger');

let extraPayloadLogged = false;

function responseObject(payload, endpoint) {
  if (!payload || typeof payload.response !== 'object' || payload.response === null) {
    console.error('[shopee-sync] Payload inesperado', { endpoint, payload });
    throw new AppError(`Resposta inesperada da Shopee em ${endpoint}`, {
      status: 502,
      code: 'invalid_shopee_payload',
    });
  }
  return payload.response;
}

function arrayField(response, field, endpoint) {
  if (!Array.isArray(response[field])) {
    console.error('[shopee-sync] Campo de lista ausente', { endpoint, field, response });
    throw new AppError(`Resposta inesperada da Shopee em ${endpoint}`, {
      status: 502,
      code: 'invalid_shopee_payload',
    });
  }
  return response[field];
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalMetric(value, field) {
  if (value === null || value === undefined) return null;
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2147483647) {
    throw new AppError(`A Shopee devolveu ${field} em formato inesperado`, {
      status: 502,
      code: 'invalid_shopee_item_payload',
    });
  }
  return parsed;
}

function canonicalItemId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= 9223372036854775807n ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function itemIdsFromListPayload(payload) {
  const response = responseObject(payload, 'product/get_item_list');
  const items = arrayField(response, 'item', 'product/get_item_list');
  const itemIds = items.map((item) => canonicalItemId(item?.item_id));
  if (itemIds.some((itemId) => itemId === null)) {
    throw new AppError('A Shopee devolveu item_id inválido na listagem', {
      status: 502,
      code: 'invalid_shopee_item_id',
    });
  }
  if (typeof response.has_next_page !== 'boolean') {
    throw new AppError('A Shopee não informou corretamente a paginação', {
      status: 502,
      code: 'invalid_shopee_pagination',
    });
  }
  const nextOffset = numeric(response.next_offset);
  if (response.has_next_page
    && (!Number.isSafeInteger(nextOffset) || nextOffset < 0)) {
    throw new AppError('A Shopee não informou o próximo offset da paginação', {
      status: 502,
      code: 'invalid_shopee_pagination',
    });
  }
  return {
    itemIds,
    hasNextPage: response.has_next_page,
    nextOffset: response.has_next_page ? nextOffset : null,
  };
}

function categoryMapFromPayload(payload) {
  const response = responseObject(payload, 'product/get_category');
  const categories = arrayField(response, 'category_list', 'product/get_category');
  return new Map(categories.flatMap((category) => {
    const id = numeric(category?.category_id);
    const name = category?.display_category_name;
    return id !== null && typeof name === 'string' ? [[id, name]] : [];
  }));
}

function extraMapFromPayload(payload) {
  const response = responseObject(payload, 'product/get_item_extra_info');
  const items = arrayField(response, 'item_list', 'product/get_item_extra_info');
  const mapped = items.map((item) => {
    const id = canonicalItemId(item?.item_id);
    if (id === null) {
      throw new AppError('A Shopee devolveu item_id inválido nas métricas', {
        status: 502,
        code: 'invalid_shopee_item_id',
      });
    }
    return [id, {
      views: optionalMetric(item.views, 'views'),
      sold: optionalMetric(item.sale, 'sale'),
      likes: optionalMetric(item.likes, 'likes'),
    }];
  });
  return new Map(mapped);
}

function mapBaseItem(item, categoryNames, extra) {
  const itemId = canonicalItemId(item?.item_id);
  const categoryId = numeric(item?.category_id);
  const title = item?.item_name;
  const description = item?.description;
  const price = numeric(item?.price_info?.[0]?.current_price);
  const stock = numeric(item?.stock_info_v2?.summary_info?.total_available_stock);
  const images = item?.image?.image_url_list;
  const attributes = item?.attribute_list;
  if (itemId === null
    || !Number.isSafeInteger(categoryId)
    || categoryId <= 0
    || categoryId > 2147483647
    || typeof title !== 'string'
    || typeof description !== 'string'
    || price === null
    || price < 0
    || !Number.isSafeInteger(stock)
    || stock < 0
    || stock > 2147483647
    || !Array.isArray(images)
    || !Array.isArray(attributes)) {
    console.error('[shopee-sync] Item base não mapeável', { itemId: item?.item_id, item });
    throw new AppError('A Shopee devolveu um anúncio em formato inesperado', {
      status: 502,
      code: 'invalid_shopee_item_payload',
    });
  }
  const metrics = extra.get(itemId) ?? {};
  return {
    shopeeItemId: BigInt(itemId),
    title,
    description,
    categoryId,
    categoryName: categoryNames.get(categoryId) ?? null,
    price,
    stock,
    images,
    attributes,
    views: metrics.views ?? null,
    sold: metrics.sold ?? null,
    likes: metrics.likes ?? null,
  };
}

function isBatchLimitError(error) {
  if (!(error instanceof shopeeApi.ShopeeApiError)) return false;
  const text = `${error.providerCode ?? ''} ${error.providerMessage ?? ''}`;
  return /limit|too many|max(?:imum)?|batch|item.?id.?list|page.?size/i.test(text);
}

async function adaptiveBatchFetch(fetcher, store, ids) {
  try {
    return [await fetcher(store, ids)];
  } catch (error) {
    if (ids.length <= 1 || !isBatchLimitError(error)) throw error;
    const middle = Math.ceil(ids.length / 2);
    const left = await adaptiveBatchFetch(fetcher, store, ids.slice(0, middle));
    const right = await adaptiveBatchFetch(fetcher, store, ids.slice(middle));
    return [...left, ...right];
  }
}

async function listAllItemIds(store, job) {
  const ids = [];
  const seenOffsets = new Set();
  let offset = 0;
  for (let page = 0; page < 10_000; page += 1) {
    if (seenOffsets.has(offset)) {
      throw new AppError('Paginação repetida recebida da Shopee', {
        status: 502,
        code: 'invalid_shopee_pagination',
      });
    }
    seenOffsets.add(offset);
    const payload = await shopeeApi.getItemList(store, {
      offset,
      pageSize: env.shopee.listPageSize,
    });
    const pageData = itemIdsFromListPayload(payload);
    ids.push(...pageData.itemIds);
    await job?.updateProgress(Math.min(20, 2 + page));
    if (!pageData.hasNextPage) return [...new Set(ids.map(String))];
    offset = pageData.nextOffset;
  }
  throw new AppError('A paginação da Shopee excedeu o limite de segurança', {
    status: 502,
    code: 'shopee_pagination_limit',
  });
}

function validateBaseRecords(itemIds, records) {
  const expectedIds = new Set(itemIds);
  const receivedIds = new Set(records.map((record) => record.shopeeItemId.toString()));
  const missingIds = itemIds.filter((itemId) => !receivedIds.has(itemId));
  const unexpectedIds = [...receivedIds].filter((itemId) => !expectedIds.has(itemId));
  const duplicateCount = records.length - receivedIds.size;
  if (missingIds.length === 0 && unexpectedIds.length === 0 && duplicateCount === 0) return;
  console.error('[shopee-sync] Divergência no retorno de base info', {
    missingIds,
    unexpectedIds,
    duplicateCount,
  });
  throw new AppError('A Shopee não devolveu os dados de todos os anúncios', {
    status: 502,
    code: 'incomplete_shopee_sync',
    details: {
      missingCount: missingIds.length,
      unexpectedCount: unexpectedIds.length,
      duplicateCount,
    },
  });
}

async function syncStore(storeId, job) {
  const store = await prisma.shopeeStore.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError('Loja não encontrada', { status: 404, code: 'store_not_found' });
  const itemIds = await listAllItemIds(store, job);
  const categoryPayload = await shopeeApi.getCategories(store);
  const categoryNames = categoryMapFromPayload(categoryPayload);
  const records = [];

  for (let index = 0; index < itemIds.length; index += env.shopee.itemBatchSize) {
    const batch = itemIds.slice(index, index + env.shopee.itemBatchSize);
    const [basePayloads, extraPayloads] = await Promise.all([
      adaptiveBatchFetch(shopeeApi.getItemBaseInfo, store, batch),
      adaptiveBatchFetch(shopeeApi.getItemExtraInfo, store, batch),
    ]);
    for (const payload of basePayloads) {
      await logRawShopeePayload({
        endpoint: 'product/get_item_base_info',
        store,
        itemIds: batch,
        payload,
      });
    }
    for (const payload of extraPayloads) {
      await logRawShopeePayload({
        endpoint: 'product/get_item_extra_info',
        store,
        itemIds: batch,
        payload,
      });
    }
    if (!extraPayloadLogged && extraPayloads[0]) {
      console.info('[shopee-sync][payload-confirmation] product/get_item_extra_info', extraPayloads[0]);
      extraPayloadLogged = true;
    }
    const extra = new Map();
    extraPayloads.forEach((payload) => {
      extraMapFromPayload(payload).forEach((value, key) => extra.set(key, value));
    });
    basePayloads.forEach((payload) => {
      const response = responseObject(payload, 'product/get_item_base_info');
      const items = arrayField(response, 'item_list', 'product/get_item_base_info');
      items.forEach((item) => records.push(mapBaseItem(item, categoryNames, extra)));
    });
    const progress = itemIds.length === 0 ? 90 : 20 + Math.round((records.length / itemIds.length) * 70);
    await job?.updateProgress(Math.min(90, progress));
    const currentJobId = job?.id ?? job?.data?.syncJobId;
    const progressUpdate = await prisma.shopeeStore.updateMany({
      where: { id: storeId, ...(currentJobId ? { syncJobId: currentJobId } : {}) },
      data: { syncProgress: Math.min(90, progress) },
    });
    if (currentJobId && progressUpdate.count !== 1) {
      throw new AppError('Job de sincronização substituído por uma execução mais nova', {
        status: 409,
        code: 'stale_sync_job',
      });
    }
  }

  validateBaseRecords(itemIds, records);

  const fetchedAt = new Date();
  const currentJobId = job?.id ?? job?.data?.syncJobId;
  await prisma.$transaction(async (tx) => {
    const fence = await tx.shopeeStore.updateMany({
      where: { id: storeId, ...(currentJobId ? { syncJobId: currentJobId } : {}) },
      data: { syncProgress: 90 },
    });
    if (currentJobId && fence.count !== 1) {
      throw new AppError('Job de sincronização substituído por uma execução mais nova', {
        status: 409,
        code: 'stale_sync_job',
      });
    }
    await tx.listingItem.updateMany({ where: { storeId }, data: { active: false } });
    for (const record of records) {
      await tx.listingItem.upsert({
        where: {
          storeId_shopeeItemId: { storeId, shopeeItemId: record.shopeeItemId },
        },
        create: { ...record, storeId, active: true, lastFetchedAt: fetchedAt },
        update: { ...record, active: true, lastFetchedAt: fetchedAt },
      });
    }
  }, { timeout: env.shopee.syncTransactionTimeoutMs });
  await job?.updateProgress(100);
  return { totalItems: records.length };
}

module.exports = {
  syncStore,
  itemIdsFromListPayload,
  categoryMapFromPayload,
  extraMapFromPayload,
  mapBaseItem,
  adaptiveBatchFetch,
  listAllItemIds,
  validateBaseRecords,
};
