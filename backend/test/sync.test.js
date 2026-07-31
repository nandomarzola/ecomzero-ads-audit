const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adaptiveBatchFetch,
  itemIdsFromListPayload,
  categoryMapFromPayload,
  extraMapFromPayload,
  listAllItemIds,
  mapBaseItem,
  validateBaseRecords,
} = require('../src/services/syncService');
const shopeeApi = require('../src/services/shopeeApiService');

test('pagina item list usando has_next_page e next_offset', () => {
  const result = itemIdsFromListPayload({
    response: {
      item: [{ item_id: 101 }, { item_id: 102 }],
      has_next_page: true,
      next_offset: 100,
    },
  });
  assert.deepEqual(result, { itemIds: ['101', '102'], hasNextPage: true, nextOffset: 100 });
});

test('preserva item_id BigInt recebido como string sem perda de precisão', () => {
  const result = itemIdsFromListPayload({
    response: {
      item: [{ item_id: '9007199254740993' }],
      has_next_page: false,
    },
  });
  assert.deepEqual(result, {
    itemIds: ['9007199254740993'],
    hasNextPage: false,
    nextOffset: null,
  });
});

test('mapeia categoria, base info e métricas confirmadas', () => {
  const categories = categoryMapFromPayload({
    response: { category_list: [{ category_id: 10, display_category_name: 'Casa' }] },
  });
  const extra = extraMapFromPayload({
    response: { item_list: [{ item_id: 101, views: 20, sale: 3, likes: 4 }] },
  });
  const item = mapBaseItem({
    item_id: 101,
    item_name: 'Produto teste',
    description: 'Descrição',
    category_id: 10,
    price_info: [{ current_price: 29.9 }],
    stock_info_v2: { summary_info: { total_available_stock: 7 } },
    image: { image_url_list: ['https://example.com/a.jpg'] },
    attribute_list: [{ original_attribute_name: 'Marca' }],
  }, categories, extra);
  assert.equal(item.shopeeItemId, 101n);
  assert.equal(item.categoryName, 'Casa');
  assert.equal(item.sold, 3);
});

test('métricas ausentes viram null e não preservam valor antigo por undefined', () => {
  const item = mapBaseItem({
    item_id: 101,
    item_name: 'Produto teste',
    description: 'Descrição',
    category_id: 10,
    price_info: [{ current_price: 29.9 }],
    stock_info_v2: { summary_info: { total_available_stock: 7 } },
    image: { image_url_list: [] },
    attribute_list: [],
  }, new Map(), new Map());
  assert.equal(item.views, null);
  assert.equal(item.sold, null);
  assert.equal(item.likes, null);
});

test('payload desconhecido falha em vez de inventar campos', () => {
  assert.throws(() => itemIdsFromListPayload({ response: { products: [] } }), /Resposta inesperada/);
  assert.throws(() => itemIdsFromListPayload({
    response: { item: [{ item_id: null }], has_next_page: false },
  }), /item_id inválido/);
  assert.throws(() => itemIdsFromListPayload({
    response: { item: [], next_offset: 100 },
  }), /paginação/);
  assert.throws(() => itemIdsFromListPayload({
    response: { item: [], has_next_page: true },
  }), /próximo offset/);
  assert.throws(() => mapBaseItem({
    item_id: 101,
    item_name: 'Produto teste',
    description: 'Descrição',
    category_id: 10,
    price_info: [{ current_price: null }],
    stock_info_v2: { summary_info: { total_available_stock: null } },
    image: { image_url_list: [] },
    attribute_list: [],
  }, new Map(), new Map()), /formato inesperado/);
});

test('paginação segue somente next_offset confirmado e remove IDs repetidos', async (t) => {
  const original = shopeeApi.getItemList;
  const offsets = [];
  shopeeApi.getItemList = async (_store, { offset }) => {
    offsets.push(offset);
    if (offset === 0) {
      return {
        response: {
          item: [{ item_id: 101 }, { item_id: 102 }],
          has_next_page: true,
          next_offset: 37,
        },
      };
    }
    return {
      response: {
        item: [{ item_id: 102 }, { item_id: 103 }],
        has_next_page: false,
      },
    };
  };
  t.after(() => { shopeeApi.getItemList = original; });
  const progress = [];
  const result = await listAllItemIds({ id: 'store-1' }, {
    updateProgress: async (value) => progress.push(value),
  });
  assert.deepEqual(offsets, [0, 37]);
  assert.deepEqual(result, ['101', '102', '103']);
  assert.deepEqual(progress, [2, 3]);
});

test('paginação repetida é rejeitada antes de repetir a chamada', async (t) => {
  const original = shopeeApi.getItemList;
  let calls = 0;
  shopeeApi.getItemList = async () => {
    calls += 1;
    return { response: { item: [], has_next_page: true, next_offset: 0 } };
  };
  t.after(() => { shopeeApi.getItemList = original; });
  await assert.rejects(listAllItemIds({ id: 'store-1' }), /Paginação repetida/);
  assert.equal(calls, 1);
});

test('lote é reduzido apenas quando a Shopee informa limite', async () => {
  const sizes = [];
  const fetcher = async (_store, ids) => {
    sizes.push(ids.length);
    if (ids.length > 2) {
      throw new shopeeApi.ShopeeApiError('limite', {
        providerCode: 'item_id_list_limit',
        providerMessage: 'maximum batch limit',
      });
    }
    return { response: { item_list: ids } };
  };
  const payloads = await adaptiveBatchFetch(fetcher, {}, ['1', '2', '3', '4', '5']);
  assert.deepEqual(sizes, [5, 3, 2, 1, 2]);
  assert.equal(payloads.length, 3);
});

test('snapshot rejeita itens ausentes, inesperados ou duplicados', () => {
  const record = (id) => ({ shopeeItemId: BigInt(id) });
  assert.doesNotThrow(() => validateBaseRecords(['1', '2'], [record(1), record(2)]));
  assert.throws(
    () => validateBaseRecords(['1', '2'], [record(1)]),
    (error) => error.code === 'incomplete_shopee_sync'
      && error.details.missingCount === 1,
  );
  assert.throws(
    () => validateBaseRecords(['1'], [record(1), record(2)]),
    (error) => error.details.unexpectedCount === 1,
  );
  assert.throws(
    () => validateBaseRecords(['1'], [record(1), record(1)]),
    (error) => error.details.duplicateCount === 1,
  );
});
