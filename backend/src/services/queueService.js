const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const env = require('../config/env');

const SYNC_QUEUE = 'shopee-sync';
const AUDIT_QUEUE = 'listing-audit';
let sharedConnection;
let syncQueue;
let auditQueue;

function createRedisConnection() {
  return new IORedis(env.requireRedis(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

function connection() {
  if (!sharedConnection) sharedConnection = createRedisConnection();
  return sharedConnection;
}

function getSyncQueue() {
  if (!syncQueue) syncQueue = new Queue(SYNC_QUEUE, { connection: connection() });
  return syncQueue;
}

function getAuditQueue() {
  if (!auditQueue) auditQueue = new Queue(AUDIT_QUEUE, { connection: connection() });
  return auditQueue;
}

async function closeQueues() {
  await Promise.all([
    syncQueue?.close(),
    auditQueue?.close(),
  ]);
  if (sharedConnection) await sharedConnection.quit();
  syncQueue = undefined;
  auditQueue = undefined;
  sharedConnection = undefined;
}

module.exports = {
  SYNC_QUEUE,
  AUDIT_QUEUE,
  createRedisConnection,
  getSyncQueue,
  getAuditQueue,
  closeQueues,
};
