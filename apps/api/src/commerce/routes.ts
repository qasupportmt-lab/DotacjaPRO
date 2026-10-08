import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
import { LEGAL_VERSION } from '../legal/policy.js';
import { envBoolean, getLegalOperatorState } from '../legal/operator.js';
import { generateAccessKey, hashAccessKey } from './access-keys.js';

type CommerceRouteDeps = {
  requireWorkerSecret: (request: FastifyRequest) => void;
  requireUserId: (request: FastifyRequest) => Promise<string>;
  requireAdminUserId: (request: FastifyRequest) => Promise<string>;
};

type FastifyRequestWithRawBody = FastifyRequest & {
  rawBody?: Buffer;
};

type StripeWebhookEnvelope = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: {
    object: Record<string, unknown>;
  };
};

function stripeWebhookSecret() {
  const value = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!value) {
    throw Object.assign(
      new Error('STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED'),
      { statusCode: 503 }
    );
  }
  return value;
}

function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  toleranceSeconds = 300
) {
  const parts = header.split(',').map((item) => item.trim());
  const timestampPart = parts.find((item) => item.startsWith('t='));
  const signatures = parts
    .filter((item) => item.startsWith('v1='))
    .map((item) => item.slice(3));

  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(String(timestamp))
    .update('.')
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    );
  });
}

function stripePaymentLinkModeEnabled() {
  return envBoolean('STRIPE_PAYMENT_LINK_MODE', false);
}

function readStripeProductMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      paymentLinkUrl: null as string | null,
      paymentLinkId: null as string | null
    };
  }

  const value = metadata as Record<string, unknown>;
  const rawUrl =
    typeof value.stripePaymentLinkUrl === 'string'
      ? value.stripePaymentLinkUrl.trim()
      : '';
  const rawId =
    typeof value.stripePaymentLinkId === 'string'
      ? value.stripePaymentLinkId.trim()
      : '';

  let paymentLinkUrl: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'buy.stripe.com' || parsed.hostname === 'book.stripe.com')
    ) {
      paymentLinkUrl = parsed.toString();
    }
  } catch {
    paymentLinkUrl = null;
  }

  return {
    paymentLinkUrl,
    paymentLinkId: rawId || null
  };
}

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.string().trim().min(1).max(80),
  active: z.boolean().default(false),
  priceGrossGrosz: z.number().int().min(0).max(2_000_000_000).nullable(),
  currency: z.literal('PLN').default('PLN'),
  deliveryType: z.enum(['DIGITAL', 'SERVICE', 'HYBRID']).default('DIGITAL'),
  supplyModel: z.enum([
    'UNCLASSIFIED',
    'PUBLICATION_ONLY',
    'PUBLICATION_WITH_INTEGRAL_DIGITAL_COMPONENT',
    'DIGITAL_SERVICE',
    'HYBRID'
  ]).default('UNCLASSIFIED'),
  taxClassificationStatus: z.enum([
    'PENDING',
    'CONFIRMED',
    'WIS_CONFIRMED',
    'REJECTED'
  ]).default('PENDING'),
  vatRateBps: z.number().int().min(0).max(2300).nullable().optional(),
  taxClassificationRef: z.string().trim().max(500).nullable().optional(),
  taxReviewedAt: z.string().datetime().nullable().optional(),
  deliveryContractVersion: z.string().trim().max(120).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if (value.active && value.priceGrossGrosz === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['priceGrossGrosz'],
      message: 'An active paid product must have a configured price'
    });
  }

  if (
    value.active &&
    !['CONFIRMED', 'WIS_CONFIRMED'].includes(value.taxClassificationStatus)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['taxClassificationStatus'],
      message: 'Active product requires confirmed tax classification'
    });
  }

  if (value.active && value.vatRateBps == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['vatRateBps'],
      message: 'Active product requires VAT rate snapshot'
    });
  }

  if (value.active && value.supplyModel === 'UNCLASSIFIED') {
    ctx.addIssue({
      code: 'custom',
      path: ['supplyModel'],
      message: 'Active product requires supply model classification'
    });
  }

  if (value.active && !value.deliveryContractVersion) {
    ctx.addIssue({
      code: 'custom',
      path: ['deliveryContractVersion'],
      message: 'Active product requires delivery contract version'
    });
  }
});

const orderSchema = z.object({
  productCode: z.string().trim().min(1).max(80),
  legalAcceptanceId: z.string().trim().min(1).max(200)
});

const accessKeyIssueSchema = z.object({
  entitlementId: z.string().trim().min(1).max(240),
  expiresInHours: z.number().int().min(1).max(24 * 90).default(24 * 30),
  purpose: z.string().trim().min(1).max(80).default('PRODUCT_ACCESS'),
  rotate: z.boolean().default(false)
});

const accessKeyRedeemSchema = z.object({
  accessKey: z.string().trim().regex(/^ak1_[A-Za-z0-9_-]{40,60}$/)
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
  const dynamicCheckoutReady = Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
    (
      process.env.CHECKOUT_RETURN_BASE_URL?.trim() ||
      process.env.APP_BASE_URL?.trim()
    )
  );
  const paymentLinkReady = Boolean(
    stripePaymentLinkModeEnabled() &&
    process.env.STRIPE_WEBHOOK_SECRET?.trim()
  );
  const stripeConfigured =
    provider === 'STRIPE'
      ? dynamicCheckoutReady || paymentLinkReady
      : true;

  return {
    provider,
    enabled,
    configured: Boolean(provider && enabled && stripeConfigured),
    adapterReady: Boolean(provider && enabled && stripeConfigured),
    stripeMode:
      provider === 'STRIPE'
        ? dynamicCheckoutReady
          ? 'CHECKOUT_SESSIONS'
          : paymentLinkReady
            ? 'PAYMENT_LINKS'
            : 'NOT_READY'
        : null
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

function calculateTaxFromGross(amountGrossGrosz: number, vatRateBps: number) {
  const amountNetGrosz = Math.round(
    amountGrossGrosz * 10_000 / (10_000 + vatRateBps)
  );
  return {
    amountNetGrosz,
    amountVatGrosz: amountGrossGrosz - amountNetGrosz
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


type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  livemode?: boolean;
  payment_intent?: string | { id?: string } | null;
};

function stripeSecret() {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  if (!value) {
    throw Object.assign(new Error('STRIPE_SECRET_KEY_NOT_CONFIGURED'), {
      statusCode: 409
    });
  }
  return value;
}

function checkoutReturnBaseUrl() {
  const value =
    process.env.CHECKOUT_RETURN_BASE_URL?.trim() ||
    process.env.APP_BASE_URL?.trim();
  if (!value) {
    throw Object.assign(new Error('CHECKOUT_RETURN_BASE_URL_NOT_CONFIGURED'), {
      statusCode: 409
    });
  }
  return value.replace(/\/$/, '');
}

async function stripeCreateCheckoutSession(input: {
  orderId: string;
  userId: string;
  productName: string;
  amountGrossGrosz: number;
  currency: string;
}) {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', input.orderId);
  body.set('metadata[orderId]', input.orderId);
  body.set('metadata[userId]', input.userId);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
  body.set('line_items[0][price_data][unit_amount]', String(input.amountGrossGrosz));
  body.set('line_items[0][price_data][product_data][name]', input.productName);
  body.set('automatic_payment_methods[enabled]', 'true');
  body.set('locale', 'pl');

  const base = checkoutReturnBaseUrl();
  body.set(
    'success_url',
    `${base}/?checkout=success&order_id=${encodeURIComponent(input.orderId)}&session_id={CHECKOUT_SESSION_ID}`
  );
  body.set(
    'cancel_url',
    `${base}/?checkout=cancel&order_id=${encodeURIComponent(input.orderId)}`
  );

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = await response.json() as StripeCheckoutSession & {
    error?: { message?: string; type?: string };
  };

  if (!response.ok || !payload.id || !payload.url) {
    throw Object.assign(
      new Error(payload.error?.message || 'STRIPE_CHECKOUT_CREATE_FAILED'),
      { statusCode: 502 }
    );
  }

  return payload;
}

async function stripeGetCheckoutSession(sessionId: string) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${stripeSecret()}`
      }
    }
  );

  const payload = await response.json() as StripeCheckoutSession & {
    error?: { message?: string; type?: string };
  };

  if (!response.ok || !payload.id) {
    throw Object.assign(
      new Error(payload.error?.message || 'STRIPE_SESSION_LOOKUP_FAILED'),
      { statusCode: 502 }
    );
  }

  return payload;
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


  app.post('/v1/internal/access-keys/issue', async (request, reply) => {
    deps.requireWorkerSecret(request);
    const parsed = accessKeyIssueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_ACCESS_KEY_ISSUE_REQUEST',
        details: parsed.error.flatten()
      });
    }

    const entitlement = await prisma.entitlement.findUnique({
      where: { id: parsed.data.entitlementId },
      include: {
        order: { select: { id: true, status: true } },
        product: { select: { id: true, code: true, name: true } }
      }
    });

    if (!entitlement || entitlement.status !== 'ACTIVE') {
      return reply.code(409).send({ error: 'ACTIVE_ENTITLEMENT_REQUIRED' });
    }
    if (!entitlement.order || entitlement.order.status !== 'PAID') {
      return reply.code(409).send({ error: 'PAID_ORDER_REQUIRED' });
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000
    );
    const accessKey = generateAccessKey();
    const tokenHash = hashAccessKey(accessKey);

    const issued = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Entitlement"
        WHERE "id" = ${entitlement.id}
        FOR UPDATE
      `;

      const existing = await tx.accessRedemptionToken.findFirst({
        where: {
          entitlementId: entitlement.id,
          status: 'ISSUED',
          expiresAt: { gt: now }
        },
        select: { id: true }
      });

      if (existing && !parsed.data.rotate) {
        return { conflict: true as const, token: null };
      }

      if (existing && parsed.data.rotate) {
        await tx.accessRedemptionToken.updateMany({
          where: {
            entitlementId: entitlement.id,
            status: 'ISSUED'
          },
          data: {
            status: 'REVOKED',
            revokedAt: now
          }
        });
      }

      const token = await tx.accessRedemptionToken.create({
        data: {
          entitlementId: entitlement.id,
          tokenHash,
          purpose: parsed.data.purpose,
          expiresAt,
          metadata: {
            orderId: entitlement.order?.id,
            productCode: entitlement.product.code
          }
        },
        select: {
          id: true,
          entitlementId: true,
          purpose: true,
          expiresAt: true,
          issuedAt: true
        }
      });

      await tx.auditEvent.create({
        data: {
          userId: entitlement.userId,
          actorType: 'SYSTEM',
          action: 'ACCESS_KEY_ISSUED',
          entity: 'AccessRedemptionToken',
          entityId: token.id,
          metadata: {
            entitlementId: entitlement.id,
            orderId: entitlement.order?.id,
            productCode: entitlement.product.code,
            expiresAt: expiresAt.toISOString(),
            purpose: parsed.data.purpose
          }
        }
      });

      return { conflict: false as const, token };
    });

    if (issued.conflict) {
      return reply.code(409).send({
        error: 'ACCESS_KEY_ALREADY_ISSUED',
        hint: 'Set rotate=true only for an intentional key rotation.'
      });
    }

    return {
      token: issued.token,
      accessKey,
      security: {
        plaintextStored: false,
        singleUse: true,
        rotationRequiredForReplacement: true
      }
    };
  });

  app.post('/v1/me/access-keys/redeem', async (request, reply) => {
    const userId = await deps.requireUserId(request);
    const parsed = accessKeyRedeemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ACCESS_KEY' });
    }

    const tokenHash = hashAccessKey(parsed.data.accessKey);
    const token = await prisma.accessRedemptionToken.findUnique({
      where: { tokenHash },
      include: {
        entitlement: {
          include: {
            product: {
              select: {
                code: true,
                name: true,
                kind: true,
                deliveryType: true
              }
            }
          }
        }
      }
    });

    if (!token || token.entitlement.userId !== userId) {
      return reply.code(400).send({ error: 'INVALID_ACCESS_KEY' });
    }
    if (token.status !== 'ISSUED') {
      return reply.code(409).send({ error: 'ACCESS_KEY_NOT_ACTIVE' });
    }
    if (token.expiresAt <= new Date()) {
      await prisma.accessRedemptionToken.update({
        where: { id: token.id },
        data: { status: 'EXPIRED' }
      });
      return reply.code(410).send({ error: 'ACCESS_KEY_EXPIRED' });
    }
    if (token.entitlement.status !== 'ACTIVE') {
      return reply.code(409).send({ error: 'ENTITLEMENT_NOT_ACTIVE' });
    }

    const now = new Date();
    const redeemed = await prisma.$transaction(async (tx) => {
      const updated = await tx.accessRedemptionToken.updateMany({
        where: {
          id: token.id,
          status: 'ISSUED',
          expiresAt: { gt: now }
        },
        data: {
          status: 'REDEEMED',
          redeemedAt: now
        }
      });

      if (updated.count !== 1) return false;

      await tx.auditEvent.create({
        data: {
          userId,
          actorType: 'USER',
          action: 'ACCESS_KEY_REDEEMED',
          entity: 'AccessRedemptionToken',
          entityId: token.id,
          metadata: {
            entitlementId: token.entitlementId,
            productCode: token.entitlement.product.code,
            purpose: token.purpose
          }
        }
      });

      return true;
    });

    if (!redeemed) {
      return reply.code(409).send({ error: 'ACCESS_KEY_NOT_ACTIVE' });
    }

    return {
      status: 'REDEEMED',
      entitlement: {
        id: token.entitlement.id,
        product: token.entitlement.product,
        grantedAt: token.entitlement.grantedAt
      }
    };
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
    if (
      !['CONFIRMED', 'WIS_CONFIRMED'].includes(product.taxClassificationStatus) ||
      product.vatRateBps === null ||
      product.supplyModel === 'UNCLASSIFIED' ||
      !product.deliveryContractVersion
    ) {
      return reply.code(409).send({
        error: 'PRODUCT_TAX_OR_DELIVERY_CLASSIFICATION_REQUIRED'
      });
    }

    const tax = calculateTaxFromGross(
      product.priceGrossGrosz,
      product.vatRateBps
    );

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
        amountNetGrosz: tax.amountNetGrosz,
        amountVatGrosz: tax.amountVatGrosz,
        vatRateBps: product.vatRateBps,
        taxClassificationRef: product.taxClassificationRef,
        taxClassificationStatus: product.taxClassificationStatus,
        supplyModel: product.supplyModel,
        deliveryContractVersion: product.deliveryContractVersion,
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

    if (provider === 'STRIPE') {
      try {
        const session = await stripeCreateCheckoutSession({
          orderId: order.id,
          userId,
          productName: product.name,
          amountGrossGrosz: product.priceGrossGrosz,
          currency: product.currency
        });

        const updatedOrder = await prisma.commerceOrder.update({
          where: { id: order.id },
          data: {
            providerCheckoutId: session.id
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
          order: updatedOrder,
          checkout: {
            provider,
            checkoutUrl: session.url,
            checkoutId: session.id,
            status: 'READY'
          }
        });
      } catch (error) {
        await prisma.commerceOrder.update({
          where: { id: order.id },
          data: { status: 'PAYMENT_SETUP_FAILED' }
        });
        throw error;
      }
    }

    return reply.code(409).send({
      error: 'PAYMENT_PROVIDER_ADAPTER_NOT_IMPLEMENTED',
      provider
    });
  });

  app.post('/v1/payments/stripe/confirm', async (request, reply) => {
    const userId = await deps.requireUserId(request);
    const parsed = z.object({
      orderId: z.string().trim().min(1).max(240),
      sessionId: z.string().trim().min(1).max(300)
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_STRIPE_CONFIRMATION' });
    }

    const order = await prisma.commerceOrder.findFirst({
      where: {
        id: parsed.data.orderId,
        userId
      },
      include: { product: true }
    });

    if (!order) {
      return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
    }
    if (order.provider !== 'STRIPE') {
      return reply.code(409).send({ error: 'ORDER_PROVIDER_MISMATCH' });
    }
    if (
      order.providerCheckoutId &&
      order.providerCheckoutId !== parsed.data.sessionId
    ) {
      return reply.code(409).send({ error: 'STRIPE_SESSION_MISMATCH' });
    }

    const session = await stripeGetCheckoutSession(parsed.data.sessionId);

    if (
      session.client_reference_id !== order.id ||
      session.metadata?.orderId !== order.id
    ) {
      return reply.code(409).send({ error: 'STRIPE_ORDER_REFERENCE_MISMATCH' });
    }
    if ((session.currency || '').toUpperCase() !== order.currency) {
      return reply.code(409).send({ error: 'STRIPE_CURRENCY_MISMATCH' });
    }
    if (session.amount_total !== order.amountGrossGrosz) {
      return reply.code(409).send({ error: 'STRIPE_AMOUNT_MISMATCH' });
    }
    if (session.payment_status !== 'paid') {
      return reply.code(409).send({
        error: 'PAYMENT_NOT_COMPLETED',
        paymentStatus: session.payment_status ?? null
      });
    }

    const workerSecret = process.env.INTERNAL_WORKER_SECRET;
    if (!workerSecret) {
      throw Object.assign(
        new Error('INTERNAL_WORKER_SECRET_NOT_CONFIGURED'),
        { statusCode: 500 }
      );
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || session.id;

    const recorded = await app.inject({
      method: 'POST',
      url: '/v1/internal/payments/record',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': workerSecret
      },
      payload: {
        provider: 'STRIPE',
        providerEventId: `checkout-confirm:${session.id}:paid`,
        eventType: 'checkout.session.confirmed',
        providerPaymentId: paymentIntentId,
        orderId: order.id,
        status: 'COMPLETED',
        currency: order.currency,
        amountReceivedGrosz: session.amount_total,
        refundedGrosz: 0,
        occurredAt: new Date().toISOString(),
        isTest: session.livemode === false,
        metadata: {
          stripeSessionId: session.id,
          confirmationMode: 'server_verified_return'
        }
      }
    });

    const body = recorded.json();
    if (recorded.statusCode >= 400) {
      return reply.code(recorded.statusCode).send(body);
    }

    const entitlement = await prisma.entitlement.findFirst({
      where: {
        userId,
        orderId: order.id,
        status: 'ACTIVE'
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

    return {
      status: 'PAID',
      orderId: order.id,
      entitlement,
      paymentRecord: body
    };
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
        supplyModel: input.supplyModel,
        taxClassificationStatus: input.taxClassificationStatus,
        vatRateBps: input.vatRateBps ?? null,
        taxClassificationRef: input.taxClassificationRef ?? null,
        taxReviewedAt: input.taxReviewedAt ? new Date(input.taxReviewedAt) : null,
        deliveryContractVersion: input.deliveryContractVersion ?? null,
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
        supplyModel: input.supplyModel,
        taxClassificationStatus: input.taxClassificationStatus,
        vatRateBps: input.vatRateBps ?? null,
        taxClassificationRef: input.taxClassificationRef ?? null,
        taxReviewedAt: input.taxReviewedAt ? new Date(input.taxReviewedAt) : null,
        deliveryContractVersion: input.deliveryContractVersion ?? null,
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
    const payloadSha256 = createHash('sha256')
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

        const refundedEntitlements = await tx.entitlement.findMany({
          where: { orderId: order.id },
          select: { id: true }
        });
        if (refundedEntitlements.length > 0) {
          await tx.accessRedemptionToken.updateMany({
            where: {
              entitlementId: { in: refundedEntitlements.map((item) => item.id) },
              status: 'ISSUED'
            },
            data: {
              status: 'REVOKED',
              revokedAt: occurredAt
            }
          });
        }
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
