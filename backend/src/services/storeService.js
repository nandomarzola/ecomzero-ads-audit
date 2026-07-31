const { randomUUID } = require('node:crypto');
const prisma = require('../lib/prisma');
const AppError = require('../lib/AppError');
const { getSyncQueue } = require('./queueService');

async function ownedStore(storeId, userId, select) {
  const store = await prisma.shopeeStore.findFirst({
    where: { id: storeId, userId },
    ...(select ? { select } : {}),
  });
  if (!store) throw new AppError('Loja não encontrada', { status: 404, code: 'store_not_found' });
  return store;
}

function listStores(userId) {
  return prisma.shopeeStore.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      shopId: true,
      shopName: true,
      status: true,
      lastSyncAt: true,
      syncStatus: true,
      syncProgress: true,
      syncError: true,
      createdAt: true,
      _count: { select: { items: { where: { active: true } } } },
    },
  });
}

async function enqueueSync(storeId, userId) {
  const store = await ownedStore(storeId, userId);
  if (['queued', 'running'].includes(store.syncStatus) && store.syncJobId) {
    return { syncJobId: store.syncJobId, reused: true };
  }
  const syncJobId = `sync-${store.id}-${randomUUID()}`;
  const claimed = await prisma.shopeeStore.updateMany({
    where: { id: store.id, syncStatus: store.syncStatus },
    data: {
      syncStatus: 'queued',
      syncJobId,
      syncProgress: 0,
      syncError: null,
      syncStartedAt: null,
      syncFinishedAt: null,
    },
  });
  if (claimed.count !== 1) {
    const current = await ownedStore(storeId, userId);
    return { syncJobId: current.syncJobId, reused: true };
  }
  try {
    await getSyncQueue().add('sync-store', { storeId: store.id, syncJobId }, {
      jobId: syncJobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 500 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
    });
  } catch (error) {
    await prisma.shopeeStore.update({
      where: { id: store.id },
      data: { syncStatus: 'failed', syncError: 'Não foi possível enfileirar a sincronização' },
    });
    throw error;
  }
  return { syncJobId, reused: false };
}

async function syncStatus(storeId, userId) {
  return ownedStore(storeId, userId, {
    id: true,
    syncStatus: true,
    syncJobId: true,
    syncProgress: true,
    syncError: true,
    syncStartedAt: true,
    syncFinishedAt: true,
    lastSyncAt: true,
  });
}

module.exports = { ownedStore, listStores, enqueueSync, syncStatus };
