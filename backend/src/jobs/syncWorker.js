const { Worker } = require('bullmq');
const prisma = require('../lib/prisma');
const { SYNC_QUEUE, createRedisConnection } = require('../services/queueService');
const { syncStore } = require('../services/syncService');

function startSyncWorker() {
  const worker = new Worker(SYNC_QUEUE, (job) => processSyncJob(job), {
    connection: createRedisConnection(),
    concurrency: 1,
  });
  worker.on('error', (error) => console.error('[sync-worker]', error));
  return worker;
}

function isFinalAttempt(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

async function processSyncJob(job, dependencies = {}) {
  const database = dependencies.database ?? prisma;
  const synchronize = dependencies.synchronize ?? syncStore;
  const { storeId } = job.data;
  const syncJobId = job.data.syncJobId ?? job.id;
  if (!syncJobId || syncJobId !== job.id) {
    console.warn('[sync-worker] Job ignorado por identidade inconsistente', {
      storeId,
      jobId: job.id,
    });
    return { skipped: true };
  }
  const claimed = await database.shopeeStore.updateMany({
    where: { id: storeId, syncJobId },
    data: {
      syncStatus: 'running',
      syncProgress: 1,
      syncError: null,
      syncStartedAt: new Date(),
    },
  });
  if (claimed.count !== 1) return { skipped: true };
  try {
    const result = await synchronize(storeId, job);
    await database.shopeeStore.updateMany({
      where: { id: storeId, syncJobId },
      data: {
        syncStatus: 'done',
        syncProgress: 100,
        syncError: null,
        syncFinishedAt: new Date(),
        lastSyncAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    if (error?.code === 'stale_sync_job') return { skipped: true };
    const finalAttempt = isFinalAttempt(job);
    await database.shopeeStore.updateMany({
      where: { id: storeId, syncJobId },
      data: {
        syncStatus: finalAttempt ? 'failed' : 'queued',
        syncError: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido',
        syncFinishedAt: finalAttempt ? new Date() : null,
      },
    }).catch(() => undefined);
    throw error;
  }
}

module.exports = { startSyncWorker, processSyncJob, isFinalAttempt };
