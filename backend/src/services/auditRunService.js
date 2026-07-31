const prisma = require('../lib/prisma');
const AppError = require('../lib/AppError');
const { getAuditQueue } = require('./queueService');
const { ownedStore } = require('./storeService');

async function enqueueAudit(storeId, userId) {
  const store = await ownedStore(storeId, userId);
  if (!store.lastSyncAt) {
    throw new AppError('Sincronize a loja antes de iniciar uma auditoria', {
      status: 409,
      code: 'sync_required',
    });
  }
  const items = await prisma.listingItem.findMany({
    where: { storeId, active: true },
    select: { id: true },
  });
  if (items.length === 0) {
    throw new AppError('A loja não possui anúncios ativos sincronizados', {
      status: 409,
      code: 'no_items_to_audit',
    });
  }
  const activeRun = await prisma.auditRun.findFirst({
    where: { storeId, status: { in: ['pending', 'running'] } },
    orderBy: { startedAt: 'desc' },
  });
  if (activeRun) {
    return { auditRunId: activeRun.id, totalItems: activeRun.totalItems, reused: true };
  }
  let auditRun;
  try {
    auditRun = await prisma.auditRun.create({
      data: {
        storeId,
        status: 'pending',
        totalItems: items.length,
        runItems: {
          create: items.map((item) => ({ itemId: item.id })),
        },
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrentRun = await prisma.auditRun.findFirst({
      where: { storeId, status: { in: ['pending', 'running'] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!concurrentRun) throw error;
    return { auditRunId: concurrentRun.id, totalItems: concurrentRun.totalItems, reused: true };
  }
  try {
    await getAuditQueue().addBulk(items.map((item) => ({
      name: 'audit-item',
      data: { auditRunId: auditRun.id, itemId: item.id },
      opts: {
        jobId: `audit-${auditRun.id}-${item.id}`,
        removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    })));
  } catch (error) {
    await prisma.$transaction([
      prisma.auditRun.update({
        where: { id: auditRun.id },
        data: { status: 'failed', failedItems: items.length, finishedAt: new Date() },
      }),
      prisma.auditRunItem.updateMany({
        where: { auditRunId: auditRun.id },
        data: { status: 'failed', errorMessage: 'Falha ao enfileirar auditoria' },
      }),
    ]);
    throw error;
  }
  return { auditRunId: auditRun.id, totalItems: items.length, reused: false };
}

async function auditStatus(storeId, userId, auditRunId) {
  await ownedStore(storeId, userId, { id: true });
  const run = await prisma.auditRun.findFirst({
    where: { id: auditRunId, storeId },
    select: {
      id: true,
      status: true,
      totalItems: true,
      processedItems: true,
      failedItems: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!run) throw new AppError('Auditoria não encontrada', { status: 404, code: 'audit_not_found' });
  return run;
}

async function refreshRunCounters(auditRunId) {
  const [run, processedItems, failedItems] = await Promise.all([
    prisma.auditRun.findUnique({ where: { id: auditRunId }, select: { totalItems: true } }),
    prisma.auditRunItem.count({ where: { auditRunId, status: 'done' } }),
    prisma.auditRunItem.count({ where: { auditRunId, status: 'failed' } }),
  ]);
  if (!run) return;
  const finished = processedItems + failedItems >= run.totalItems;
  await prisma.auditRun.update({
    where: { id: auditRunId },
    data: {
      status: finished ? (processedItems === 0 ? 'failed' : 'done') : 'running',
      processedItems,
      failedItems,
      finishedAt: finished ? new Date() : null,
    },
  });
}

module.exports = { enqueueAudit, auditStatus, refreshRunCounters };
