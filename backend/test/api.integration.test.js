const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = process.env.RUN_LOCAL_INTEGRATION === '1';

test('API local protege autenticação, CORS e isolamento entre tenants', {
  skip: !enabled,
}, async () => {
  process.env.TOKEN_ENCRYPTION_KEY ||= '22'.repeat(32);
  const app = require('../src/app');
  const prisma = require('../src/lib/prisma');
  const { encrypt } = require('../src/services/shopeeCryptoService');
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emails = [`tenant-a-${suffix}@example.com`, `tenant-b-${suffix}@example.com`];
  const userIds = [];
  try {
    const register = async (email) => {
      const response = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5174' },
        body: JSON.stringify({ email, password: 'Senha-segura-123' }),
      });
      assert.equal(response.status, 201);
      return response.json();
    };
    const [tenantA, tenantB] = await Promise.all(emails.map(register));
    userIds.push(tenantA.user.id, tenantB.user.id);

    const me = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${tenantA.token}` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, tenantA.user.id);

    const stores = await Promise.all([
      prisma.shopeeStore.create({
        data: {
          userId: tenantA.user.id,
          shopId: `71${Date.now()}`,
          accessToken: encrypt('access-a'),
          refreshToken: encrypt('refresh-a'),
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
      prisma.shopeeStore.create({
        data: {
          userId: tenantB.user.id,
          shopId: `72${Date.now()}`,
          accessToken: encrypt('access-b'),
          refreshToken: encrypt('refresh-b'),
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
    ]);

    const listResponse = await fetch(`${baseUrl}/stores`, {
      headers: { authorization: `Bearer ${tenantA.token}` },
    });
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.deepEqual(list.stores.map((store) => store.id), [stores[0].id]);

    const forbiddenTenant = await fetch(`${baseUrl}/stores/${stores[1].id}/items`, {
      headers: { authorization: `Bearer ${tenantA.token}` },
    });
    assert.equal(forbiddenTenant.status, 404);

    const forbiddenOrigin = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal((await forbiddenOrigin.json()).code, 'cors_forbidden');
  } finally {
    if (userIds.length > 0) {
      await prisma.shopeeStore.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
