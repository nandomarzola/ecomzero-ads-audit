const { Worker } = require('bullmq');
const env = require('../config/env');
const prisma = require('../lib/prisma');
const { AUDIT_QUEUE, createRedisConnection } = require('../services/queueService');
const { auditListing } = require('../services/auditService');
const { refreshRunCounters } = require('../services/auditRunService');

async function processAuditJob(job) {
  const { auditRunId, itemId } = job.data;
  const runItem = await prisma.auditRunItem.findUnique({
    where: { auditRunId_itemId: { auditRunId, itemId } },
  });
  if (!runItem || ['done', 'failed'].includes(runItem.status)) return;
  await prisma.$transaction([
    prisma.auditRun.update({ where: { id: auditRunId }, data: { status: 'running' } }),
    prisma.auditRunItem.update({
      where: { id: runItem.id },
      data: { status: 'running', errorMessage: null },
    }),
  ]);
  const item = await prisma.listingItem.findUnique({ where: { id: itemId } });
  try {
    if (!item) throw new Error('Anúncio não encontrado');
    const result = await auditListing(item);
    await prisma.$transaction([
      prisma.listingAudit.upsert({
        where: { auditRunId_itemId: { auditRunId, itemId } },
        create: {
          auditRunId,
          itemId,
          score: result.score,
          issues: result.issues,
          suggestedTitle: result.suggested_title ?? null,
          suggestedDesc: result.suggested_description ?? null,
          suggestedAttrs: result.suggested_attributes ?? undefined,
        },
        update: {
          score: result.score,
          issues: result.issues,
          suggestedTitle: result.suggested_title ?? null,
          suggestedDesc: result.suggested_description ?? null,
          suggestedAttrs: result.suggested_attributes ?? undefined,
        },
      }),
      prisma.auditRunItem.update({
        where: { id: runItem.id },
        data: { status: 'done', errorMessage: null },
      }),
    ]);
  } catch (error) {
    console.error('[audit-worker] Item falhou', {
      auditRunId,
      itemId,
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });
    await prisma.auditRunItem.update({
      where: { id: runItem.id },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido',
      },
    });
  }
  await refreshRunCounters(auditRunId);
}

function startAuditWorker() {
  const worker = new Worker(AUDIT_QUEUE, processAuditJob, {
    connection: createRedisConnection(),
    concurrency: env.anthropic.workerConcurrency,
    limiter: {
      max: env.anthropic.requestsPerMinute,
      duration: 60_000,
    },
  });
  worker.on('error', (error) => console.error('[audit-worker]', error));
  return worker;
}

module.exports = { startAuditWorker, processAuditJob };
