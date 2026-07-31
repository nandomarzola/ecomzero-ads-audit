const test = require('node:test');
const assert = require('node:assert/strict');
const { isFinalAttempt, processSyncJob } = require('../src/jobs/syncWorker');

function job(overrides = {}) {
  return {
    id: 'sync-job-1',
    data: { storeId: 'store-1', syncJobId: 'sync-job-1' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  };
}

function databaseDouble(counts = []) {
  const updates = [];
  return {
    updates,
    shopeeStore: {
      async updateMany(input) {
        updates.push(input);
        return { count: counts.length > 0 ? counts.shift() : 1 };
      },
    },
  };
}

test('identifica corretamente tentativa final do BullMQ', () => {
  assert.equal(isFinalAttempt(job()), false);
  assert.equal(isFinalAttempt(job({ attemptsMade: 1 })), false);
  assert.equal(isFinalAttempt(job({ attemptsMade: 2 })), true);
});

test('job antigo não inicia nem chama a sincronização', async () => {
  const database = databaseDouble([0]);
  let synchronized = false;
  const result = await processSyncJob(job(), {
    database,
    synchronize: async () => { synchronized = true; },
  });
  assert.deepEqual(result, { skipped: true });
  assert.equal(synchronized, false);
  assert.deepEqual(database.updates[0].where, {
    id: 'store-1',
    syncJobId: 'sync-job-1',
  });
});

test('falha recuperável mantém estado queued até o retry', async () => {
  const database = databaseDouble();
  const failure = new Error('Shopee indisponível');
  await assert.rejects(
    processSyncJob(job(), {
      database,
      synchronize: async () => { throw failure; },
    }),
    failure,
  );
  assert.equal(database.updates[0].data.syncStatus, 'running');
  assert.equal(database.updates[1].data.syncStatus, 'queued');
  assert.equal(database.updates[1].data.syncFinishedAt, null);
});

test('somente a última tentativa marca o sync como failed', async () => {
  const database = databaseDouble();
  const failure = new Error('Falha definitiva');
  await assert.rejects(
    processSyncJob(job({ attemptsMade: 2 }), {
      database,
      synchronize: async () => { throw failure; },
    }),
    failure,
  );
  assert.equal(database.updates[1].data.syncStatus, 'failed');
  assert.ok(database.updates[1].data.syncFinishedAt instanceof Date);
});

test('sucesso só atualiza o status do syncJobId que executou', async () => {
  const database = databaseDouble();
  const result = await processSyncJob(job(), {
    database,
    synchronize: async () => ({ totalItems: 4 }),
  });
  assert.deepEqual(result, { totalItems: 4 });
  assert.equal(database.updates[1].data.syncStatus, 'done');
  assert.deepEqual(database.updates[1].where, {
    id: 'store-1',
    syncJobId: 'sync-job-1',
  });
});
