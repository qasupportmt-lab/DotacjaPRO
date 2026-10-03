import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
import { validateTelegramInitData } from './security/telegram.js';
import { createSessionToken, verifySessionToken } from './security/session.js';
import { VOIVODESHIPS } from './data/voivodeships.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true
});

app.get('/health', async () => ({
  service: 'dotacjapro-api',
  status: 'ok',
  officialFormOnly: true
}));

app.get('/v1/system/policy', async () => ({
  official_form_only: true,
  regional_routing: true,
  legal_snapshot_required: true,
  source_verification_required: true
}));

app.get('/v1/metadata/voivodeships', async () => ({
  items: VOIVODESHIPS
}));

async function requireUserId(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  const { userId } = await verifySessionToken(auth.slice(7));
  return userId;
}

const authSchema = z.object({
  initData: z.string().min(10)
});

app.post('/v1/auth/telegram', async (request, reply) => {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return reply.code(503).send({ error: 'BOT_NOT_CONFIGURED' });

  try {
    const telegram = validateTelegramInitData(parsed.data.initData, botToken);
    const t = telegram.user;

    const user = await prisma.user.upsert({
      where: { telegramUserId: String(t.id) },
      update: {
        telegramUsername: t.username ?? null,
        telegramFirstName: t.first_name,
        telegramLastName: t.last_name ?? null,
        preferredLanguage: t.language_code ?? 'pl'
      },
      create: {
        telegramUserId: String(t.id),
        telegramUsername: t.username ?? null,
        telegramFirstName: t.first_name,
        telegramLastName: t.last_name ?? null,
        preferredLanguage: t.language_code ?? 'pl',
        profile: { create: {} },
        fundingProfile: { create: {} },
        notificationPreference: { create: {} }
      },
      include: {
        profile: true,
        fundingProfile: true,
        notificationPreference: true
      }
    });

    const token = await createSessionToken(user.id);
    return {
      token,
      user: {
        id: user.id,
        firstName: user.telegramFirstName,
        username: user.telegramUsername,
        profile: user.profile,
        fundingProfile: user.fundingProfile,
        notificationPreference: user.notificationPreference
      }
    };
  } catch (error) {
    request.log.warn({ error }, 'Telegram auth failed');
    return reply.code(401).send({ error: 'TELEGRAM_AUTH_FAILED' });
  }
});

const regionSchema = z.object({
  voivodeship: z.enum(VOIVODESHIPS),
  city: z.string().min(2).max(120),
  municipality: z.string().min(2).max(120).optional(),
  county: z.string().min(2).max(120).optional(),
  postalCode: z.string().regex(/^\d{2}-\d{3}$/).optional()
});

app.put('/v1/me/region', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = regionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REGION', details: parsed.error.flatten() });

  const region = parsed.data;
  const now = new Date();

  const assignments = await prisma.regionAssignment.findMany({
    where: {
      voivodeship: region.voivodeship,
      OR: [
        { city: region.city },
        ...(region.municipality ? [{ municipality: region.municipality }] : []),
        ...(region.county ? [{ county: region.county }] : [])
      ],
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] }
      ]
    },
    select: { institutionId: true, role: true, verifiedAt: true, sourceUrl: true }
  });

  const pup = assignments.find((a) => a.role === 'PUP');
  const wup = assignments.find((a) => a.role === 'WUP');
  const lgd = assignments.find((a) => a.role === 'LGD');

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {
      ...region,
      pupOfficeId: pup?.institutionId ?? null,
      wupOfficeId: wup?.institutionId ?? null,
      lgdId: lgd?.institutionId ?? null,
      regionVerified: Boolean(pup || wup || lgd),
      regionSource: pup?.sourceUrl ?? wup?.sourceUrl ?? lgd?.sourceUrl ?? null
    },
    create: {
      userId,
      ...region,
      pupOfficeId: pup?.institutionId ?? null,
      wupOfficeId: wup?.institutionId ?? null,
      lgdId: lgd?.institutionId ?? null,
      regionVerified: Boolean(pup || wup || lgd),
      regionSource: pup?.sourceUrl ?? wup?.sourceUrl ?? lgd?.sourceUrl ?? null
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'REGION_PROFILE_UPDATED',
      entity: 'UserProfile',
      entityId: profile.id,
      metadata: region
    }
  });

  return {
    profile,
    routing: {
      pupOfficeId: pup?.institutionId ?? null,
      wupOfficeId: wup?.institutionId ?? null,
      lgdId: lgd?.institutionId ?? null,
      verified: profile.regionVerified
    }
  };
});

const fundingProfileSchema = z.object({
  employmentStatus: z.enum([
    'UNEMPLOYED_REGISTERED',
    'NOT_WORKING_UNREGISTERED',
    'EMPLOYED',
    'STUDENT',
    'FARMER',
    'CIS_GRADUATE',
    'KIS_GRADUATE',
    'DISABILITY_CARER',
    'OTHER'
  ]),
  wantsToStartBusiness: z.boolean(),
  plannedLegalForm: z.string().max(80).optional(),
  plannedBusinessDescription: z.string().max(4000).optional(),
  businessActiveLast12Months: z.boolean().optional(),
  priorNonRepayableStartupAid: z.boolean().optional(),
  wantsPfronPath: z.boolean().optional()
});

app.put('/v1/me/funding-profile', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = fundingProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_FUNDING_PROFILE', details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const profile = await prisma.fundingProfile.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data }
  });

  return { profile };
});

const caseSchema = z.object({
  caseType: z.enum(['START_BUSINESS', 'PUP_STARTUP', 'EU_STARTUP', 'LGD_STARTUP', 'PFRON_STARTUP', 'BUSINESS_DEVELOPMENT'])
});

app.post('/v1/cases', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = caseSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CASE' });

  const item = await prisma.case.create({
    data: {
      userId,
      status: 'QUALIFICATION',
      caseType: parsed.data.caseType
    }
  });

  return reply.code(201).send({ case: item });
});

app.get('/v1/me/dashboard', async (request) => {
  const userId = await requireUserId(request);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      fundingProfile: true,
      notificationPreference: true,
      cases: { orderBy: { updatedAt: 'desc' }, take: 10 },
      notifications: {
        where: { sentAt: null },
        orderBy: [{ priority: 'asc' }, { scheduledAt: 'asc' }],
        take: 10
      }
    }
  });

  return {
    user: {
      id: user.id,
      firstName: user.telegramFirstName,
      email: user.email,
      profile: user.profile,
      fundingProfile: user.fundingProfile,
      notificationPreference: user.notificationPreference
    },
    cases: user.cases,
    notifications: user.notifications
  };
});

app.setErrorHandler((error, request, reply) => {
  const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
  if (statusCode >= 500) request.log.error({ error }, 'Unhandled API error');
  reply.code(statusCode).send({
    error: statusCode === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR'
  });
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
