const prisma = require('../lib/prisma');
const AppError = require('../lib/AppError');
const { ownedStore } = require('./storeService');

function serializeItem(item) {
  const latestAudit = item.audits?.[0] ?? null;
  return {
    id: item.id,
    storeId: item.storeId,
    shopeeItemId: item.shopeeItemId.toString(),
    title: item.title,
    description: item.description,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    price: Number(item.price),
    stock: item.stock,
    images: item.images,
    attributes: item.attributes,
    views: item.views,
    sold: item.sold,
    likes: item.likes,
    lastFetchedAt: item.lastFetchedAt,
    latestAudit: latestAudit ? {
      id: latestAudit.id,
      score: latestAudit.score,
      issues: latestAudit.issues,
      suggestedTitle: latestAudit.suggestedTitle,
      suggestedDesc: latestAudit.suggestedDesc,
      suggestedAttrs: latestAudit.suggestedAttrs,
      appliedAt: latestAudit.appliedAt,
      createdAt: latestAudit.createdAt,
    } : null,
  };
}

async function listStoreItems(storeId, userId, { page, pageSize }) {
  await ownedStore(storeId, userId, { id: true });
  const where = { storeId, active: true };
  const [items, total] = await Promise.all([
    prisma.listingItem.findMany({
      where,
      orderBy: { title: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { audits: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.listingItem.count({ where }),
  ]);
  return {
    items: items.map(serializeItem),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

async function ownedItem(itemId, userId) {
  const item = await prisma.listingItem.findFirst({
    where: { id: itemId, store: { userId } },
    include: { audits: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!item) throw new AppError('Anúncio não encontrado', { status: 404, code: 'item_not_found' });
  return item;
}

async function itemDetails(itemId, userId) {
  return serializeItem(await ownedItem(itemId, userId));
}

async function auditHistory(itemId, userId, { page, pageSize }) {
  await ownedItem(itemId, userId);
  const where = { itemId };
  const [audits, total] = await Promise.all([
    prisma.listingAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        score: true,
        issues: true,
        suggestedTitle: true,
        suggestedDesc: true,
        suggestedAttrs: true,
        appliedAt: true,
        createdAt: true,
        auditRun: { select: { id: true, status: true } },
      },
    }),
    prisma.listingAudit.count({ where }),
  ]);
  return {
    audits,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

module.exports = { listStoreItems, itemDetails, auditHistory, serializeItem };
