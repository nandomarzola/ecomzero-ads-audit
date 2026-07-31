const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const enabled = process.env.RUN_FULL_MOCK_E2E === '1';

test('fluxo completo OAuth, sync, auditoria e leitura com provedores simulados', {
  skip: !enabled,
}, async () => {
  const mock = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock.local');
    const json = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!url.searchParams.get('sign') && url.pathname.startsWith('/api/v2/')) {
      return json({ error: 'missing_sign', message: 'signature required' }, 400);
    }
    if (url.pathname === '/api/v2/auth/token/get') {
      return json({ access_token: 'mock-access', refresh_token: 'mock-refresh', expire_in: 14400 });
    }
    if (url.pathname === '/api/v2/product/get_item_list') {
      return json({ response: { item: [{ item_id: 901001 }], has_next_page: false, next_offset: 0 } });
    }
    if (url.pathname === '/api/v2/product/get_category') {
      return json({ response: { category_list: [{ category_id: 42, display_category_name: 'Casa' }] } });
    }
    if (url.pathname === '/api/v2/product/get_item_base_info') {
      return json({
        response: {
          item_list: [{
            item_id: 901001,
            item_name: 'Luminária de mesa LED',
            description: 'Luminária compacta para mesa. Inclui cabo e manual.',
            category_id: 42,
            price_info: [{ current_price: 39.9 }],
            stock_info_v2: { summary_info: { total_available_stock: 12 } },
            image: { image_url_list: ['https://example.test/a.jpg'] },
            attribute_list: [{ original_attribute_name: 'Marca', is_mandatory: true }],
          }],
        },
      });
    }
    if (url.pathname === '/api/v2/product/get_item_extra_info') {
      return json({ response: { item_list: [{ item_id: 901001, views: 35, sale: 4, likes: 2 }] } });
    }
    if (url.pathname === '/v1/messages') {
      return json({
        content: [{
          type: 'text',
          text: JSON.stringify({
            score: 74,
            issues: [{ field: 'images', severity: 'critical', message: 'Adicione mais imagens reais.' }],
            suggested_title: 'Luminária LED de Mesa Compacta com Cabo',
            suggested_description: 'Descrição organizada em blocos.',
            suggested_attributes: { Marca: 'Informar marca real' },
          }),
        }],
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const { port } = mock.address();
  process.env.SHOPEE_PARTNER_ID = '2036419';
  process.env.SHOPEE_PARTNER_KEY = 'mock-partner-key';
  process.env.SHOPEE_HOST = `http://127.0.0.1:${port}`;
  process.env.SHOPEE_REDIRECT_URL = `http://127.0.0.1:${port}/callback`;
  process.env.TOKEN_ENCRYPTION_KEY = '33'.repeat(32);
  process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
  process.env.ANTHROPIC_HOST = `http://127.0.0.1:${port}`;

  const prisma = require('../src/lib/prisma');
  const shopeeAuth = require('../src/services/shopeeAuthService');
  const { syncStore } = require('../src/services/syncService');
  const { processAuditJob } = require('../src/jobs/auditWorker');
  const { itemDetails } = require('../src/services/itemService');
  const { enqueueAudit } = require('../src/services/auditRunService');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let user;
  let store;
  try {
    user = await prisma.user.create({
      data: {
        email: `mock-flow-${suffix}@example.com`,
        passwordHash: 'not-used-in-this-test',
      },
    });
    const tokens = await shopeeAuth.exchangeAuthorizationCode({ code: 'mock-code', shopId: '611286890' });
    store = await shopeeAuth.saveConnectedStore({
      userId: user.id,
      shopId: `8${Date.now()}`,
      tokens,
    });
    assert.match(store.accessToken, /^enc:v1:/);
    assert.match(store.refreshToken, /^enc:v1:/);

    const progress = [];
    const sync = await syncStore(store.id, { updateProgress: async (value) => progress.push(value) });
    assert.equal(sync.totalItems, 1);
    assert.equal(progress.at(-1), 100);
    const item = await prisma.listingItem.findFirst({ where: { storeId: store.id } });
    assert.equal(item.title, 'Luminária de mesa LED');
    assert.equal(item.sold, 4);
    await prisma.shopeeStore.update({
      where: { id: store.id },
      data: { lastSyncAt: new Date() },
    });

    const run = await prisma.auditRun.create({
      data: {
        storeId: store.id,
        totalItems: 1,
        runItems: { create: [{ itemId: item.id }] },
      },
    });
    const reusedRun = await enqueueAudit(store.id, user.id);
    assert.deepEqual(reusedRun, { auditRunId: run.id, totalItems: 1, reused: true });
    await processAuditJob({ data: { auditRunId: run.id, itemId: item.id } });
    const finished = await prisma.auditRun.findUnique({ where: { id: run.id } });
    assert.equal(finished.status, 'done');
    assert.equal(finished.processedItems, 1);
    assert.equal(finished.failedItems, 0);

    const details = await itemDetails(item.id, user.id);
    assert.equal(details.latestAudit.score, 74);
    assert.equal(details.latestAudit.issues[0].field, 'images');
  } finally {
    if (store) {
      await prisma.listingAudit.deleteMany({ where: { item: { storeId: store.id } } });
      await prisma.auditRun.deleteMany({ where: { storeId: store.id } });
      await prisma.listingItem.deleteMany({ where: { storeId: store.id } });
      await prisma.shopeeStore.deleteMany({ where: { id: store.id } });
    }
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
    await new Promise((resolve) => mock.close(resolve));
  }
});
