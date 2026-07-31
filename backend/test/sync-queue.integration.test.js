const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');

const enabled = process.env.RUN_SYNC_QUEUE_INTEGRATION === '1';

test('sync percorre fila BullMQ, worker, Shopee simulada e persistência', {
  skip: !enabled,
  timeout: 20_000,
}, async () => {
  const requestedPaths = [];
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock.local');
    requestedPaths.push(url.pathname);
    const send = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!url.searchParams.get('sign')) {
      return send({ error: 'missing_sign', message: 'signature required' }, 400);
    }
    if (url.pathname === '/api/v2/product/get_item_list') {
      return send({
        response: {
          item: [{ item_id: '901001' }],
          has_next_page: false,
        },
      });
    }
    if (url.pathname === '/api/v2/product/get_category') {
      return send({
        response: {
          category_list: [{ category_id: 42, display_category_name: 'Casa' }],
        },
      });
    }
    if (url.pathname === '/api/v2/product/get_item_base_info') {
      return send({
        response: {
          item_list: [{
            item_id: '901001',
            item_name: 'Luminária de mesa LED',
            description: 'Luminária compacta para mesa.',
            category_id: 42,
            price_info: [{ current_price: 39.9 }],
            stock_info_v2: { summary_info: { total_available_stock: 12 } },
            image: { image_url_list: ['https://example.test/a.jpg'] },
            attribute_list: [{ original_attribute_name: 'Marca' }],
          }],
        },
      });
    }
    if (url.pathname === '/api/v2/product/get_item_extra_info') {
      return send({
        response: {
          item_list: [{ item_id: '901001', views: 35, sale: 4, likes: 2 }],
        },
      });
    }
    return send({ error: 'not_found' }, 404);
  });

  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const { port } = mock.address();
  process.env.SHOPEE_PARTNER_ID = '2036419';
  process.env.SHOPEE_PARTNER_KEY = 'mock-partner-key';
  process.env.SHOPEE_HOST = `http://127.0.0.1:${port}`;
  process.env.SHOPEE_REDIRECT_URL = `http://127.0.0.1:${port}/callback`;
  process.env.TOKEN_ENCRYPTION_KEY = '55'.repeat(32);
  process.env.JWT_SECRET = 'sync-queue-test-jwt-secret-32-bytes';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.SHOPEE_RAW_PAYLOAD_LOG_ENABLED = 'true';
  process.env.SHOPEE_RAW_PAYLOAD_LOG_PATH = `/tmp/ecomzero-ads-audit-sync-${process.pid}-${Date.now()}.jsonl`;

  const app = require('../src/app');
  const prisma = require('../src/lib/prisma');
  const { encrypt } = require('../src/services/shopeeCryptoService');
  const { signToken } = require('../src/services/auth.service');
  const { startSyncWorker } = require('../src/jobs/syncWorker');
  const { closeWorkers } = require('../src/jobs');
  const { closeQueues, getSyncQueue } = require('../src/services/queueService');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let user;
  let store;
  let worker;
  let queueJob;
  let apiServer;

  try {
    user = await prisma.user.create({
      data: {
        email: `sync-queue-${suffix}@example.com`,
        passwordHash: 'not-used-in-this-test',
      },
    });
    store = await prisma.shopeeStore.create({
      data: {
        userId: user.id,
        shopId: `9${Date.now()}`,
        accessToken: encrypt('mock-access'),
        refreshToken: encrypt('mock-refresh'),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    apiServer = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const apiAddress = apiServer.address();
    const response = await fetch(`http://127.0.0.1:${apiAddress.port}/api/stores/${store.id}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken(user)}` },
    });
    assert.equal(response.status, 202);
    const queued = await response.json();
    assert.equal(queued.reused, false);
    queueJob = await getSyncQueue().getJob(queued.syncJobId);
    assert.ok(queueJob);
    assert.deepEqual(queueJob.data, {
      storeId: store.id,
      syncJobId: queued.syncJobId,
    });

    worker = startSyncWorker();
    let current;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      current = await prisma.shopeeStore.findUnique({ where: { id: store.id } });
      if (current.syncStatus === 'done' || current.syncStatus === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(current.syncStatus, 'done', current.syncError ?? 'sync não finalizou');
    assert.equal(current.syncProgress, 100);
    assert.equal(current.syncJobId, queued.syncJobId);
    assert.ok(current.lastSyncAt instanceof Date);
    const item = await prisma.listingItem.findUnique({
      where: {
        storeId_shopeeItemId: { storeId: store.id, shopeeItemId: 901001n },
      },
    });
    assert.equal(item.title, 'Luminária de mesa LED');
    assert.equal(item.sold, 4);
    assert.deepEqual(requestedPaths, [
      '/api/v2/product/get_item_list',
      '/api/v2/product/get_category',
      '/api/v2/product/get_item_base_info',
      '/api/v2/product/get_item_extra_info',
    ]);
    assert.equal(requestedPaths.some((path) => /update|add|delete/i.test(path)), false);
    const rawEntries = (await fs.readFile(process.env.SHOPEE_RAW_PAYLOAD_LOG_PATH, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(rawEntries.map((entry) => entry.endpoint), [
      'product/get_item_base_info',
      'product/get_item_extra_info',
    ]);
    assert.equal(rawEntries[0].payload.response.item_list[0].item_name, 'Luminária de mesa LED');
    assert.equal(rawEntries[1].payload.response.item_list[0].sale, 4);
  } finally {
    if (worker) await closeWorkers([worker]);
    if (queueJob) await queueJob.remove().catch(() => undefined);
    await closeQueues();
    if (apiServer) {
      apiServer.closeAllConnections();
      await new Promise((resolve) => apiServer.close(resolve));
    }
    if (store) {
      await prisma.listingItem.deleteMany({ where: { storeId: store.id } });
      await prisma.shopeeStore.deleteMany({ where: { id: store.id } });
    }
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
    await new Promise((resolve) => mock.close(resolve));
    await fs.unlink(process.env.SHOPEE_RAW_PAYLOAD_LOG_PATH).catch(() => undefined);
  }
});
