import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
import {
  calculatePit36ActivityLine,
  calculateQuarterLimitSummary,
  formatPln,
  polandQuarter,
  polandYear
} from './calculator.js';

type AccountingRouteDeps = {
  requireWorkerSecret: (request: FastifyRequest) => void;
  requireAdminUserId: (request: FastifyRequest) => Promise<string>;
};

const saleSchema = z.object({
  provider: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  providerTransactionId: z.string().trim().min(1).max(200),
  providerOrderId: z.string().trim().min(1).max(200).optional(),
  userId: z.string().trim().min(1).max(200).optional(),
  status: z.enum([
    'COMPLETED',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'CANCELLED',
    'FAILED'
  ]).default('COMPLETED'),
  currency: z.literal('PLN').default('PLN'),
  amountDueGrosz: z.number().int().min(0).max(2_000_000_000),
  amountReceivedGrosz: z.number().int().min(0).max(2_000_000_000),
  refundedGrosz: z.number().int().min(0).max(2_000_000_000).default(0),
  dueAt: z.string().datetime(),
  receivedAt: z.string().datetime().optional(),
  refundedAt: z.string().datetime().optional(),
  isTest: z.boolean().default(false),
  description: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.refundedGrosz > value.amountReceivedGrosz) {
    ctx.addIssue({
      code: 'custom',
      path: ['refundedGrosz'],
      message: 'Refund cannot exceed received amount'
    });
  }
  if (
    ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(value.status) &&
    !value.receivedAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['receivedAt'],
      message: 'receivedAt is required for a completed payment'
    });
  }
});

const expenseSchema = z.object({
  amountGrosz: z.number().int().min(1).max(2_000_000_000),
  currency: z.literal('PLN').default('PLN'),
  incurredAt: z.string().datetime(),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  documentReference: z.string().trim().min(1).max(200).optional(),
  deductible: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.deductible && !value.documentReference) {
    ctx.addIssue({
      code: 'custom',
      path: ['documentReference'],
      message: 'A documented reference is required for a deductible expense'
    });
  }
});

function adminTelegramIds() {
  return (process.env.ADMIN_TELEGRAM_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function telegramAdminAllowed(telegramUserId: string) {
  if (adminTelegramIds().includes(telegramUserId)) {
    return true;
  }

  const emails = adminEmails();
  if (emails.length === 0) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { telegramUserId },
    select: { email: true }
  });

  return Boolean(user?.email && emails.includes(user.email.toLowerCase()));
}

function safeYear(value: unknown) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2100
    ? year
    : polandYear(new Date());
}

function safeQuarter(value: unknown) {
  const quarter = Number(value);
  return Number.isInteger(quarter) && quarter >= 1 && quarter <= 4
    ? quarter
    : polandQuarter(new Date());
}

async function loadAccountingData(year: number) {
  const from = new Date(Date.UTC(year - 1, 11, 30, 0, 0, 0));
  const to = new Date(Date.UTC(year + 1, 0, 2, 23, 59, 59));

  const [sales, expenses] = await Promise.all([
    prisma.saleTransaction.findMany({
      where: {
        OR: [
          { dueAt: { gte: from, lte: to } },
          { receivedAt: { gte: from, lte: to } },
          { refundedAt: { gte: from, lte: to } }
        ]
      },
      orderBy: { dueAt: 'asc' }
    }),
    prisma.accountingExpense.findMany({
      where: { incurredAt: { gte: from, lte: to } },
      orderBy: { incurredAt: 'asc' }
    })
  ]);

  return { sales, expenses };
}

async function accountingSummary(year: number, quarter: number) {
  const { sales, expenses } = await loadAccountingData(year);
  const quarterSummary = calculateQuarterLimitSummary(sales, year, quarter);
  const pit36 = calculatePit36ActivityLine(sales, expenses, year);

  return {
    generatedAt: new Date().toISOString(),
    timezone: 'Europe/Warsaw',
    quarter: {
      ...quarterSummary,
      dueRevenuePln: formatPln(quarterSummary.dueRevenueGrosz),
      limitPln:
        quarterSummary.limitGrosz === null
          ? null
          : formatPln(quarterSummary.limitGrosz),
      remainingPln:
        quarterSummary.remainingGrosz === null
          ? null
          : formatPln(quarterSummary.remainingGrosz),
      exceededByPln:
        quarterSummary.exceededByGrosz === null
          ? null
          : formatPln(quarterSummary.exceededByGrosz)
    },
    pit36: {
      ...pit36,
      receivedRevenuePln: formatPln(pit36.receivedRevenueGrosz),
      refundsInYearPln: formatPln(pit36.refundsInYearGrosz),
      revenueCandidatePln: formatPln(pit36.revenueCandidateGrosz),
      deductibleCostsPln: formatPln(pit36.deductibleCostsGrosz),
      incomeCandidatePln:
        pit36.incomeCandidateGrosz < 0
          ? '-' + formatPln(Math.abs(pit36.incomeCandidateGrosz))
          : formatPln(pit36.incomeCandidateGrosz)
    }
  };
}

async function queueAdminSaleAlert(
  saleId: string,
  provider: string,
  providerTransactionId: string,
  amountReceivedGrosz: number,
  refundedGrosz: number,
  year: number,
  quarter: number
) {
  const ids = adminTelegramIds();
  const emails = adminEmails();

  if (ids.length === 0 && emails.length === 0) {
    return { queued: 0, botDeliveryTriggered: false };
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(ids.length > 0 ? [{ telegramUserId: { in: ids } }] : []),
        ...(emails.length > 0 ? [{ email: { in: emails, mode: 'insensitive' as const } }] : [])
      ]
    },
    select: {
      id: true,
      telegramUserId: true,
      notificationPreference: {
        select: { telegramWriteAccess: true }
      }
    }
  });

  const summary = await accountingSummary(year, quarter);
  let queued = 0;

  for (const user of users) {
    if (!user.telegramUserId) continue;

    if (!user.notificationPreference?.telegramWriteAccess) {
      await prisma.notificationPreference.upsert({
        where: { userId: user.id },
        update: { telegramWriteAccess: true },
        create: { userId: user.id, telegramWriteAccess: true }
      });
    }

    const remaining = summary.quarter.remainingPln;
    const limitText = summary.quarter.limitPln ?? 'wymaga aktualizacji';
    const remainingText =
      remaining === null
        ? 'limit prawny wymaga aktualizacji'
        : summary.quarter.thresholdExceeded
          ? `limit przekroczony o ${summary.quarter.exceededByPln} zł`
          : `${remaining} zł`;

    const dedupeKey = [
      'accounting-sale',
      provider,
      providerTransactionId,
      amountReceivedGrosz,
      refundedGrosz
    ].join(':');

    await prisma.notification.upsert({
      where: {
        userId_dedupeKey: {
          userId: user.id,
          dedupeKey
        }
      },
      update: {
        title: 'DotacjaPRO — sprzedaż',
        body: [
          `Transakcja: ${formatPln(amountReceivedGrosz)} zł`,
          `Przychód należny Q${quarter} ${year}: ${summary.quarter.dueRevenuePln} zł / ${limitText} zł`,
          `Do limitu: ${remainingText}`,
          `ID księgowe: ${saleId}`
        ].join('\n'),
        scheduledAt: new Date(),
        failedAt: null,
        failureReason: null
      },
      create: {
        userId: user.id,
        category: 'ACCOUNTING_SALE',
        priority: summary.quarter.thresholdExceeded ? 'P0' : 'P2',
        title: 'DotacjaPRO — sprzedaż',
        body: [
          `Transakcja: ${formatPln(amountReceivedGrosz)} zł`,
          `Przychód należny Q${quarter} ${year}: ${summary.quarter.dueRevenuePln} zł / ${limitText} zł`,
          `Do limitu: ${remainingText}`,
          `ID księgowe: ${saleId}`
        ].join('\n'),
        scheduledAt: new Date(),
        dedupeKey
      }
    });
    queued++;
  }

  let botDeliveryTriggered = false;
  const botBase =
    process.env.TELEGRAM_BOT_INTERNAL_URL ||
    process.env.RAILWAY_SERVICE_TELEGRAM_BOT_URL;

  const workerSecret = process.env.INTERNAL_WORKER_SECRET;
  if (queued > 0 && botBase && workerSecret) {
    try {
      const response = await fetch(
        botBase.replace(/\/$/, '') + '/internal/deliver?limit=100',
        {
          method: 'POST',
          headers: { 'x-worker-secret': workerSecret },
          signal: AbortSignal.timeout(5000)
        }
      );
      botDeliveryTriggered = response.ok;
    } catch {
      botDeliveryTriggered = false;
    }
  }

  return { queued, botDeliveryTriggered };
}

export async function registerAccountingRoutes(
  app: FastifyInstance,
  deps: AccountingRouteDeps
) {
  app.post('/v1/internal/accounting/sales/record', async (request, reply) => {
    deps.requireWorkerSecret(request);
    const parsed = saleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_ACCOUNTING_SALE',
        details: parsed.error.flatten()
      });
    }

    const input = parsed.data;
    const existing = await prisma.saleTransaction.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: input.provider,
          providerTransactionId: input.providerTransactionId
        }
      }
    });

    const data = {
      userId: input.userId ?? null,
      provider: input.provider,
      providerTransactionId: input.providerTransactionId,
      providerOrderId: input.providerOrderId ?? null,
      status: input.status,
      currency: input.currency,
      amountDueGrosz: input.amountDueGrosz,
      amountReceivedGrosz: input.amountReceivedGrosz,
      refundedGrosz: input.refundedGrosz,
      dueAt: new Date(input.dueAt),
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
      refundedAt: input.refundedAt ? new Date(input.refundedAt) : null,
      isTest: input.isTest,
      description: input.description ?? null,
      metadata: (input.metadata ?? undefined) as any
    };

    const changed =
      !existing ||
      existing.status !== data.status ||
      existing.amountDueGrosz !== data.amountDueGrosz ||
      existing.amountReceivedGrosz !== data.amountReceivedGrosz ||
      existing.refundedGrosz !== data.refundedGrosz ||
      existing.isTest !== data.isTest;

    const sale = await prisma.saleTransaction.upsert({
      where: {
        provider_providerTransactionId: {
          provider: input.provider,
          providerTransactionId: input.providerTransactionId
        }
      },
      update: data,
      create: data
    });

    const year = polandYear(sale.dueAt);
    const quarter = polandQuarter(sale.dueAt);
    const summary = await accountingSummary(year, quarter);

    let alert = { queued: 0, botDeliveryTriggered: false };
    if (changed && !sale.isTest && ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(sale.status)) {
      alert = await queueAdminSaleAlert(
        sale.id,
        sale.provider,
        sale.providerTransactionId,
        sale.amountReceivedGrosz,
        sale.refundedGrosz,
        year,
        quarter
      );
    }

    return {
      status: existing ? 'UPDATED_OR_REUSED' : 'RECORDED',
      changed,
      sale: {
        id: sale.id,
        provider: sale.provider,
        providerTransactionId: sale.providerTransactionId,
        amountDueGrosz: sale.amountDueGrosz,
        amountReceivedGrosz: sale.amountReceivedGrosz,
        refundedGrosz: sale.refundedGrosz,
        dueAt: sale.dueAt,
        receivedAt: sale.receivedAt,
        status: sale.status,
        isTest: sale.isTest
      },
      quarter: summary.quarter,
      alert
    };
  });

  app.get('/v1/internal/accounting/summary', async (request, reply) => {
    deps.requireWorkerSecret(request);
    const query = request.query as {
      telegramUserId?: string;
      year?: string;
      quarter?: string;
    };

    if (
      !query.telegramUserId ||
      !(await telegramAdminAllowed(query.telegramUserId))
    ) {
      return reply.code(403).send({ error: 'ADMIN_TELEGRAM_REQUIRED' });
    }

    return accountingSummary(safeYear(query.year), safeQuarter(query.quarter));
  });

  app.get('/v1/admin/accounting/summary', async (request) => {
    await deps.requireAdminUserId(request);
    const query = request.query as { year?: string; quarter?: string };
    return accountingSummary(safeYear(query.year), safeQuarter(query.quarter));
  });

  app.get('/v1/admin/accounting/pit36-preview', async (request) => {
    await deps.requireAdminUserId(request);
    const query = request.query as { year?: string };
    const year = safeYear(query.year);
    const { sales, expenses } = await loadAccountingData(year);
    return calculatePit36ActivityLine(sales, expenses, year);
  });

  app.post('/v1/admin/accounting/expenses', async (request, reply) => {
    const adminUserId = await deps.requireAdminUserId(request);
    const parsed = expenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_ACCOUNTING_EXPENSE',
        details: parsed.error.flatten()
      });
    }

    const input = parsed.data;
    const expense = await prisma.accountingExpense.create({
      data: {
        createdByUserId: adminUserId,
        amountGrosz: input.amountGrosz,
        currency: input.currency,
        incurredAt: new Date(input.incurredAt),
        category: input.category,
        description: input.description ?? null,
        documentReference: input.documentReference ?? null,
        deductible: input.deductible,
        metadata: (input.metadata ?? undefined) as any
      }
    });

    return reply.code(201).send({ expense });
  });
}
