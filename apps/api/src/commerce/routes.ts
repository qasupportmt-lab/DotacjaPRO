import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
import { LEGAL_VERSION } from '../legal/policy.js';
import { envBoolean, getLegalOperatorState } from '../legal/operator.js';

type CommerceRouteDeps = {
  requireWorkerSecret: (request: FastifyRequest) => void;
  requireUserId: (request: FastifyRequest) => Promise<string>;
  requireAdminUserId: (request: FastifyRequest) => Promise<string>;
};

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.string().trim().min(1).max(80),
  active: z.boolean().default(false),
  priceGrossGrosz: z.number().int().min(0).max(2_000_000_000).nullable(),
  currency: z.literal('PLN').default('PLN'),
  deliveryType: z.enum(['DIGITAL', 'SERVICE', 'HYBRID']).default('DIGITAL'),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.active && value.priceGrossGrosz === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['priceGrossGrosz'],
      message: 'An active paid product must have a configured price'
    });
  }
});

const orderSchema = z.object({
  productCode: z.string().trim().min(1).max(80),
  legalAcceptanceId: z.string().trim().min(1).max(200)
});

const paymentRecordSchema = z.object({
  provider: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  providerEventId: z.string().trim().min(1).max(240),
  eventType: z.string().trim().min(1).max(120),
  providerPaymentId: z.string().trim().min(1).max(240),
  orderId: z.string().trim().min(1).max(240),
  status: z.enum([
    'PENDING',
    'COMPLETED',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'FAILED',
    'CANCELLED'
  ]),
  currency: z.literal('PLN').default('PLN'),
  amountReceivedGrosz: z.number().int().min(0).max(2_000_000_000),
  refundedGrosz: z.number().int().min(0).max(2_000_000_000).default(0),
  occurredAt: z.string().datetime(),
  dueAt: z.string().datetime().optional(),
  isTest: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.refundedGrosz > value.amountReceivedGrosz) {
    ctx.addIssue({
      code: 'custom',
      path: ['refundedGrosz'],
      message: 'Refund cannot exceed the received amount'
    });
  }
});

function paymentProviderState() {
  const provider = process.env.PAYMENT_PROVIDER?.trim().toUpperCase() || null;
  const enabled = envBoolean('PAYMENT_PROVIDER_ENABLED', false);

  return {
    provider,
    configured: Boolean(provider && enabled)
  };
}

function checkoutReadiness() {
  const legal = getLegalOperatorState();
  const payment = paymentProviderState();

  let blockedReason = legal.checkoutBlockedReason;
  if (!blockedReason && !payment.configured) {
    blockedReason = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  }

  return {
    ready: legal.checkoutAllowed && payment.configured,
    blockedReason,
    legal,
    payment
  };
}

function checkoutAcceptanceValid(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = metadata as Record<string, unknown>;
  return (
    value.context === 'CHECKOUT' &&
    value.termsAccepted === true &&
    value.licenseAccepted === true &&
    value.privacyAcknowledged === true &&
    value.digitalImmediateConsent === true &&
    value.withdrawalAcknowledged === true
  );
}

async function sendSaleToAccounting(
  app: FastifyInstance,
  input: {
    provider: string;
    providerPaymentId: string;
    orderId: string;
    userId: string;
    status: string;
    currency: 'PLN';
    amountDueGrosz: number;
    amountReceivedGrosz: number;
    refundedGrosz: number;
    dueAt: Date;
    occurredAt: Date;
    isTest: boolean;
    description: string;
  }
) {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) {
    throw new Error('INTERNAL_WORKER_SECRET_NOT_CONFIGURED');
  }

  const accountingStatus =
    input.status === 'REFUNDED'
      ? 'REFUNDED'
      : input.status === 'PARTIALLY_REFUNDED'
        ? 'PARTIALLY_REFUNDED'
        : input.status === 'COMPLETED'
          ? 'COMPLETED'
          : input.status === 'FAILED'
            ? 'FAILED'
            : 'CANCELLED';

  const response = await app.inject({
    method: 'POST',
    url: '/v1/internal/accounting/sales/record',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': secret
    },
    payload: {
      provider: input.provider,
      providerTransactionId: input.providerPaymentId,
      providerOrderId: input.orderId,
      userId: input.userId,
      status: accountingStatus,
      currency: input.currency,
      amountDueGrosz: input.amountDueGrosz,
      amountReceivedGrosz: input.amountReceivedGrosz,
      refundedGrosz: input.refundedGrosz,
      dueAt: input.dueAt.toISOString(),
      receivedAt:
        ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(input.status)
          ? input.occurredAt.toISOString()
          : undefined,
      refundedAt:
        input.refundedGrosz > 0 ? input.occurredAt.toISOString() : undefined,
      isTest: input.isTest,
      description: input.description,
      metadata: {
        commerceOrderId: input.orderId
      }
    }
  });

  if (response.statusCode >= 400) {
    throw new Error('ACCOUNTING_SALE_RECORD_FAILED_' + response.statusCode);
  }

  return response.json();
}

export async function registerCommerceRoutes(
  app: FastifyInstance,
  deps: CommerceRouteDeps
) {
  app.get('/v1/checkout/readiness', async () => {
    const state = checkoutReadiness();
    return {
      ready: state.ready,
      blockedReason: state.blockedReason,
      legal: {
        checkoutAllowed: state.legal.checkoutAllowed,
        checkoutBlockedReason: state.legal.checkoutBlockedReason,
        operatorType: state.legal.operatorType,
        representativeRequired: state.legal.representativeRequired,
        taxClassificationConfirmed: state.legal.taxClassificationConfirmed
      },
      payment: state.payment
    };
  });

  app.get('/v1/products', async () => {
    const products = await prisma.commerceProduct.findMany({
      where: {
        active: true,
        priceGrossGrosz: { not: null }
      },
      select: {
        code: true,
        name: true,
        description: true,
        kind: true,
        priceGrossGrosz: true,
        currency: true,
        deliveryType: true
      },
      orderBy: { code: 'asc' }
    });

    return { products };
  });

  app.get('/v1/me/orders', async (request) => {
    const userId = await deps.requireUserId(request);
    const orders = await prisma.commerceOrder.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            code: true,
            name: true,
            deliveryType: true
          }
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            provider: true,
            status: true,
            amountReceivedGrosz: true,
            refundedGrosz: true,
            receivedAt: true,
            refundedAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return { orders };
  });

  app.get('/v1/me/entitlements', async (request) => {
    const userId = await deps.requireUserId(request);
    const entitlements = await prisma.entitlement.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        product: {
          select: {
            code: true,
            name: true,
            kind: true,
            deliveryType: true
          }
        }
      },
      orderBy: { grantedAt: 'desc' }
    });

    return { entitlements };
  });

  app.post('/v1/orders', async (request, reply) => {
    const userId = await deps.requireUserId(request);
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_ORDER_REQUEST',
        details: parsed.error.flatten()
      });
    }

    const readiness = checkoutReadiness();
    if (!readiness.ready) {
      return reply.code(409).send({
        error: 'CHECKOUT_NOT_READY',
        blockedReason: readiness.blockedReason
      });
    }

    const product = await prisma.commerceProduct.findUnique({
      where: { code: parsed.data.productCode }
    });

    if (!product || !product.active) {
      return reply.code(404).send({ error: 'PRODUCT_NOT_AVAILABLE' });
    }
    if (product.priceGrossGrosz === null) {
      return reply.code(409).send({ error: 'PRODUCT_PRICE_NOT_CONFIGURED' });
    }

    const acceptance = await prisma.auditEvent.findFirst({
      where: {
        id: parsed.data.legalAcceptanceId,
        userId,
        action: 'LEGAL_ACCEPTANCE',
        entity: 'LEGAL_TERMS',
        entityId: LEGAL_VERSION
      },
      select: {
        id: true,
        metadata: true
      }
    });

    if (!acceptance || !checkoutAcceptanceValid(acceptance.metadata)) {
      return reply.code(409).send({
        error: 'CURRENT_CHECKOUT_LEGAL_ACCEPTANCE_REQUIRED',
        legalVersion: LEGAL_VERSION
      });
    }

    const provider = readiness.payment.provider;
    if (!provider) {
      return reply.code(409).send({
        error: 'PAYMENT_PROVIDER_NOT_CONFIGURED'
      });
    }

    const order = await prisma.commerceOrder.create({
      data: {
        userId,
        productId: product.id,
        status: 'PENDING_PAYMENT',
        currency: product.currency,
        amountGrossGrosz: product.priceGrossGrosz,
        legalVersion: LEGAL_VERSION,
        legalAcceptanceId: acceptance.id,
        provider
      },
      include: {
        product: {
          select: {
            code: true,
            name: true,
            deliveryType: true
          }
        }
      }
    });

    return reply.code(201).send({
      order,
      checkout: {
        provider,
        checkoutUrl: null,
        status: 'PROVIDER_ADAPTER_REQUIRED'
      }
    });
  });

  app.get('/v1/admin/commerce/access', async (request) => {
    await deps.requireAdminUserId(request);

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { entitlements: { some: { status: 'ACTIVE' } } },
          { cases: { some: { documents: { some: {} } } } },
          { cases: { some: { packageJobs: { some: { status: 'COMPLETED' } } } } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entitlements: {
          where: { status: 'ACTIVE' },
          select: {
            product: { select: { code: true, name: true } }
          }
        },
        cases: {
          select: {
            documents: { select: { id: true } },
            packageJobs: {
              where: { status: 'COMPLETED' },
              select: { id: true }
            }
          }
        }
      }
    });

    return {
      users: users.map((user) => ({
        userRef: user.id.slice(-8),
        packages: user.entitlements.map((item) => item.product),
        documentCount: user.cases.reduce(
          (total, item) => total + item.documents.length,
          0
        ),
        completedPackageCount: user.cases.reduce(
          (total, item) => total + item.packageJobs.length,
          0
        )
      }))
    };
  });

  app.get('/v1/admin/commerce/products', async (request) => {
    await deps.requireAdminUserId(request);
    const products = await prisma.commerceProduct.findMany({
      orderBy: { code: 'asc' }
    });
    return { products };
  });

  app.put('/v1/admin/commerce/products/:code', async (request, reply) => {
    await deps.requireAdminUserId(request);
    const code = String((request.params as { code?: string }).code ?? '')
      .trim()
      .toUpperCase();

    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(code)) {
      return reply.code(400).send({ error: 'INVALID_PRODUCT_CODE' });
    }

    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_PRODUCT',
        details: parsed.error.flatten()
      });
    }

    const input = parsed.data;
    const product = await prisma.commerceProduct.upsert({
      where: { code },
      update: {
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        active: input.active,
        priceGrossGrosz: input.priceGrossGrosz,
        currency: input.currency,
        deliveryType: input.deliveryType,
        metadata: (input.metadata ?? undefined) as any
      },
      create: {
        code,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        active: input.active,
        priceGrossGrosz: input.priceGrossGrosz,
        currency: input.currency,
        deliveryType: input.deliveryType,
        metadata: (input.metadata ?? undefined) as any
      }
    });

    return { product };
  });

  app.post('/v1/internal/payments/record', async (request, reply) => {
    deps.requireWorkerSecret(request);
    const parsed = paymentRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_PAYMENT_RECORD',
        details: parsed.error.flatten()
      });
    }

    const input = parsed.data;
    const payloadSha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');

    const existingEvent = await prisma.paymentEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.providerEventId
        }
      }
    });

    if (
      existingEvent &&
      existingEvent.payloadSha256 !== payloadSha256
    ) {
      return reply.code(409).send({
        error: 'PAYMENT_EVENT_PAYLOAD_MISMATCH'
      });
    }

    if (existingEvent?.processedAt && existingEvent.status === 'PROCESSED') {
      return {
        status: 'IDEMPOTENT_REPLAY',
        eventId: existingEvent.id
      };
    }

    const order = await prisma.commerceOrder.findUnique({
      where: { id: input.orderId },
      include: { product: true }
    });
    if (!order) {
      return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
    }
    if (order.currency !== input.currency) {
      return reply.code(409).send({ error: 'PAYMENT_CURRENCY_MISMATCH' });
    }
    if (order.provider && order.provider !== input.provider) {
      return reply.code(409).send({ error: 'PAYMENT_PROVIDER_MISMATCH' });
    }

    const existingPayment = await prisma.paymentRecord.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId
        }
      },
      select: { orderId: true }
    });
    if (existingPayment && existingPayment.orderId !== order.id) {
      return reply.code(409).send({ error: 'PAYMENT_ORDER_MISMATCH' });
    }

    if (
      ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(input.status) &&
      input.amountReceivedGrosz < order.amountGrossGrosz
    ) {
      return reply.code(409).send({ error: 'PAYMENT_AMOUNT_BELOW_ORDER_TOTAL' });
    }

    const occurredAt = new Date(input.occurredAt);
    const dueAt = input.dueAt ? new Date(input.dueAt) : order.createdAt;

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.paymentEvent.upsert({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId
          }
        },
        update: {
          eventType: input.eventType,
          payloadSha256,
          status: 'PROCESSING',
          errorCode: null
        },
        create: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payloadSha256,
          status: 'PROCESSING'
        }
      });

      const payment = await tx.paymentRecord.upsert({
        where: {
          provider_providerPaymentId: {
            provider: input.provider,
            providerPaymentId: input.providerPaymentId
          }
        },
        update: {
          orderId: order.id,
          status: input.status,
          currency: input.currency,
          amountReceivedGrosz: input.amountReceivedGrosz,
          refundedGrosz: input.refundedGrosz,
          isTest: input.isTest,
          receivedAt:
            ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(input.status)
              ? occurredAt
              : null,
          refundedAt: input.refundedGrosz > 0 ? occurredAt : null,
          metadata: (input.metadata ?? undefined) as any
        },
        create: {
          orderId: order.id,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          status: input.status,
          currency: input.currency,
          amountReceivedGrosz: input.amountReceivedGrosz,
          refundedGrosz: input.refundedGrosz,
          isTest: input.isTest,
          receivedAt:
            ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(input.status)
              ? occurredAt
              : null,
          refundedAt: input.refundedGrosz > 0 ? occurredAt : null,
          metadata: (input.metadata ?? undefined) as any
        }
      });

      if (['COMPLETED', 'PARTIALLY_REFUNDED'].includes(input.status)) {
        await tx.commerceOrder.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            paidAt: occurredAt
          }
        });

        await tx.entitlement.upsert({
          where: {
            userId_productId_orderId: {
              userId: order.userId,
              productId: order.productId,
              orderId: order.id
            }
          },
          update: {
            status: 'ACTIVE',
            revokedAt: null
          },
          create: {
            userId: order.userId,
            productId: order.productId,
            orderId: order.id,
            status: 'ACTIVE',
            metadata: {
              provider: input.provider,
              paymentId: payment.id
            }
          }
        });
      }

      if (input.status === 'REFUNDED') {
        await tx.commerceOrder.update({
          where: { id: order.id },
          data: { status: 'REFUNDED' }
        });
        await tx.entitlement.updateMany({
          where: { orderId: order.id, status: 'ACTIVE' },
          data: {
            status: 'REVOKED',
            revokedAt: occurredAt
          }
        });
      }

      if (['FAILED', 'CANCELLED'].includes(input.status) && order.status !== 'PAID') {
        await tx.commerceOrder.update({
          where: { id: order.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: occurredAt
          }
        });
      }

      await tx.auditEvent.create({
        data: {
          userId: order.userId,
          actorType: 'SYSTEM',
          action: 'PAYMENT_STATUS_RECORDED',
          entity: 'COMMERCE_ORDER',
          entityId: order.id,
          metadata: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            providerPaymentId: input.providerPaymentId,
            status: input.status,
            amountReceivedGrosz: input.amountReceivedGrosz,
            refundedGrosz: input.refundedGrosz,
            isTest: input.isTest
          }
        }
      });

      await tx.paymentEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorCode: null
        }
      });

      return { event, payment };
    });

    let accounting: unknown = null;
    if (input.status !== 'PENDING') {
      try {
        accounting = await sendSaleToAccounting(app, {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          orderId: order.id,
          userId: order.userId,
          status: input.status,
          currency: input.currency,
          amountDueGrosz: order.amountGrossGrosz,
          amountReceivedGrosz: input.amountReceivedGrosz,
          refundedGrosz: input.refundedGrosz,
          dueAt,
          occurredAt,
          isTest: input.isTest,
          description: order.product.name
        });
      } catch (error) {
        await prisma.paymentEvent.update({
          where: { id: result.event.id },
          data: {
            status: 'ACCOUNTING_RETRY_REQUIRED',
            errorCode: error instanceof Error
              ? error.message.slice(0, 180)
              : 'ACCOUNTING_SYNC_FAILED'
          }
        });
      }
    }

    return {
      status: 'RECORDED',
      eventId: result.event.id,
      paymentId: result.payment.id,
      accounting
    };
  });
}
