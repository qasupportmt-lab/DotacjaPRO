import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@dotacjapro/db';

type Deps = { requireWorkerSecret: (request: FastifyRequest) => void };

export async function registerSupervisorRoutes(app: FastifyInstance, deps: Deps) {
  app.post('/v1/internal/supervisor/activity-event', async (request, reply) => {
    deps.requireWorkerSecret(request);

    const body = request.body as { action?: unknown };
    const action = typeof body?.action === 'string'
      ? body.action.trim().slice(0, 120)
      : '';

    if (!action) {
      return reply.code(400).send({ error: 'ACTION_REQUIRED' });
    }

    await prisma.auditEvent.create({
      data: {
        actorType: 'SYSTEM',
        action: 'APP_ACTIVITY',
        entity: 'DORADCAPRO',
        metadata: { action }
      }
    });

    return reply.code(201).send({ status: 'RECORDED' });
  });

  app.get('/v1/internal/supervisor/summary', async (request) => {
    deps.requireWorkerSecret(request);
    const now = new Date();
    const since24h = new Date(now.getTime() - 86400000);
    const since7d = new Date(now.getTime() - 7 * 86400000);
    const [usersTotal, users24h, casesTotal, cases7d, orders7d, payments7d, failedPayments7d, pendingNotifications, failedNotifications, openChanges, renderFailures, packageFailures, products, activeEntitlementsTotal, documentsTotal, completedPackagesTotal, auditEvents24h] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since24h } } }),
      prisma.case.count(),
      prisma.case.count({ where: { createdAt: { gte: since7d } } }),
      prisma.commerceOrder.count({ where: { createdAt: { gte: since7d } } }),
      prisma.paymentRecord.findMany({ where: { createdAt: { gte: since7d }, isTest: false }, select: { status: true, amountReceivedGrosz: true, refundedGrosz: true, order: { select: { product: { select: { code: true, name: true } } } } } }),
      prisma.paymentRecord.count({ where: { createdAt: { gte: since7d }, status: 'FAILED', isTest: false } }),
      prisma.notification.count({ where: { sentAt: null, failedAt: null } }),
      prisma.notification.count({ where: { failedAt: { not: null } } }),
      prisma.changeEvent.count({ where: { verified: false } }),
      prisma.documentRenderJob.count({ where: { status: 'FAILED', requestedAt: { gte: since7d } } }),
      prisma.documentPackageJob.count({ where: { status: 'FAILED', requestedAt: { gte: since7d } } }),
      prisma.commerceProduct.findMany({ select: { code: true, name: true, active: true } }),
      prisma.entitlement.count({ where: { status: 'ACTIVE' } }),
      prisma.caseDocument.count(),
      prisma.documentPackageJob.count({ where: { status: 'COMPLETED' } }),
      prisma.auditEvent.count({ where: { createdAt: { gte: since24h } } })
    ]);
    const stats = new Map<string, { code: string; name: string; purchases: number; netGrosz: number }>();
    for (const payment of payments7d) {
      if (!['COMPLETED','PARTIALLY_REFUNDED','REFUNDED'].includes(payment.status)) continue;
      const p = payment.order.product;
      const row = stats.get(p.code) ?? { code: p.code, name: p.name, purchases: 0, netGrosz: 0 };
      row.purchases++;
      row.netGrosz += Math.max(0, payment.amountReceivedGrosz - payment.refundedGrosz);
      stats.set(p.code, row);
    }
    const ranking = [...stats.values()].sort((a,b) => b.purchases - a.purchases || b.netGrosz - a.netGrosz);
    const sold = new Set(ranking.map(x => x.code));
    const noSales = products.filter(p => p.active && !sold.has(p.code)).map(p => ({ code: p.code, name: p.name }));
    const netRevenueGrosz = payments7d.reduce((sum,p) => ['COMPLETED','PARTIALLY_REFUNDED','REFUNDED'].includes(p.status) ? sum + Math.max(0,p.amountReceivedGrosz-p.refundedGrosz) : sum, 0);
    const alerts = [
      failedPayments7d ? `${failedPayments7d} nieudanych płatności / 7 dni` : null,
      failedNotifications ? `${failedNotifications} niedostarczonych powiadomień` : null,
      renderFailures ? `${renderFailures} błędów renderowania / 7 dni` : null,
      packageFailures ? `${packageFailures} błędów paczek / 7 dni` : null,
      openChanges ? `${openChanges} niezweryfikowanych zmian źródłowych` : null
    ].filter(Boolean);
    return { generatedAt: now.toISOString(), users: { total: usersTotal, new24h: users24h }, cases: { total: casesTotal, new7d: cases7d }, commerce: { orders7d, netRevenueGrosz, failedPayments7d, ranking, noSales }, access: { activeEntitlementsTotal, documentsTotal, completedPackagesTotal }, operations: { pendingNotifications, failedNotifications, openChanges, renderFailures7d: renderFailures, packageFailures7d: packageFailures, auditEvents24h }, alerts };
  });
}
