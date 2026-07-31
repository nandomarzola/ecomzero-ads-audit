const { startSyncWorker } = require('./syncWorker');
const { startAuditWorker } = require('./auditWorker');

function startWorkers() {
  return [startSyncWorker(), startAuditWorker()];
}

async function closeWorkers(workers) {
  await Promise.all(workers.map(async (worker) => {
    const redisConnection = worker.opts?.connection;
    try {
      await worker.close();
    } finally {
      if (redisConnection?.status !== 'end') {
        await redisConnection?.quit?.().catch(() => redisConnection?.disconnect?.());
      }
    }
  }));
}

module.exports = { startWorkers, closeWorkers };
