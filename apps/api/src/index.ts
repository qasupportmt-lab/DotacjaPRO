import Fastify, { type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import cors from '@fastify/cors';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
import {
  assessLocalCriteria,
  buildLocalCriterionQuestions,
  qualifyPupStartup,
  QUALIFICATION_ENGINE_VERSION
} from '@dotacjapro/rules';
import { validateTelegramInitData } from './security/telegram.js';
import { createSessionToken, verifySessionToken } from './security/session.js';
import { VOIVODESHIPS } from './data/voivodeships.js';
import { sendEmailVerificationCode } from './email/mailer.js';
import { generateEmailCode, hashEmailCode, emailCodeMatches } from './security/email-code.js';

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

function configuredAdminTelegramIds() {
  return new Set(
    (process.env.ADMIN_TELEGRAM_USER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
  );
}

function isAdminTelegramUserId(telegramUserId: string) {
  return configuredAdminTelegramIds().has(telegramUserId);
}

async function requireAdminUserId(request: FastifyRequest) {
  const userId = await requireUserId(request);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramUserId: true }
  });

  if (!user || !isAdminTelegramUserId(user.telegramUserId)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  }

  return userId;
}


const regionSearchSchema = z.object({
  voivodeship: z.enum(VOIVODESHIPS),
  q: z.string().trim().min(2).max(120)
});

app.get('/v1/regions/search', async (request, reply) => {
  const parsed = regionSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_REGION_SEARCH' });
  }

  const items = await prisma.regionAssignment.findMany({
    where: {
      role: 'PUP',
      voivodeship: parsed.data.voivodeship,
      municipality: {
        contains: parsed.data.q,
        mode: 'insensitive'
      },
      OR: [
        { validTo: null },
        { validTo: { gte: new Date() } }
      ]
    },
    include: {
      institution: {
        select: {
          id: true,
          name: true,
          officialUrl: true
        }
      }
    },
    orderBy: [
      { municipality: 'asc' },
      { verifiedAt: 'desc' }
    ],
    take: 30
  });

  const unique = new Map<string, typeof items[number]>();
  for (const item of items) {
    const key = `${item.voivodeship}|${item.municipality?.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  return {
    items: [...unique.values()].map((item) => ({
      voivodeship: item.voivodeship,
      county: item.county,
      municipality: item.municipality,
      city: item.city,
      pup: {
        id: item.institution.id,
        name: item.institution.name,
        officialUrl: item.institution.officialUrl
      },
      verifiedAt: item.verifiedAt,
      sourceUrl: item.sourceUrl
    }))
  };
});


const locationSearchSchema = z.object({
  voivodeship: z.enum(VOIVODESHIPS),
  q: z.string().trim().min(2).max(120)
});

app.get('/v1/locations/search', async (request, reply) => {
  const parsed = locationSearchSchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_LOCATION_SEARCH' });
  }

  const localities = await prisma.terytLocality.findMany({
    where: {
      name: { contains: parsed.data.q, mode: 'insensitive' },
      municipality: {
        voivodeship: parsed.data.voivodeship,
        OR: [
          { validTo: null },
          { validTo: { gte: new Date() } }
        ]
      }
    },
    include: {
      municipality: true
    },
    orderBy: [{ name: 'asc' }],
    take: 30
  });

  const items = [];
  for (const locality of localities) {
    const municipality = locality.municipality;

    const routing = await prisma.regionAssignment.findFirst({
      where: {
        role: 'PUP',
        voivodeship: municipality.voivodeship,
        municipality: {
          equals: municipality.municipality,
          mode: 'insensitive'
        },
        OR: [
          { validTo: null },
          { validTo: { gte: new Date() } }
        ]
      },
      include: {
        institution: {
          select: {
            id: true,
            name: true,
            officialUrl: true
          }
        }
      },
      orderBy: { verifiedAt: 'desc' }
    });

    items.push({
      locality: {
        simcCode: locality.simcCode,
        name: locality.name,
        type: locality.localityType
      },
      municipality: {
        tercCode: municipality.tercCode,
        name: municipality.municipality,
        type: municipality.municipalityType,
        county: municipality.county,
        voivodeship: municipality.voivodeship
      },
      terytVerified: true,
      pup: routing ? {
        id: routing.institution.id,
        name: routing.institution.name,
        officialUrl: routing.institution.officialUrl,
        verifiedAt: routing.verifiedAt,
        sourceUrl: routing.sourceUrl
      } : null
    });
  }

  return { items };
});

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
        notificationPreference: user.notificationPreference,
        isAdmin: isAdminTelegramUserId(user.telegramUserId)
      }
    };
  } catch (error) {
    request.log.warn({ error }, 'Telegram auth failed');
    return reply.code(401).send({ error: 'TELEGRAM_AUTH_FAILED' });
  }
});


const emailStartSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase())
});

app.post('/v1/me/email/start', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = emailStartSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_EMAIL' });

  const email = parsed.data.email;
  const existing = await prisma.user.findFirst({
    where: { email, NOT: { id: userId } },
    select: { id: true }
  });
  if (existing) return reply.code(409).send({ error: 'EMAIL_ALREADY_IN_USE' });

  const code = generateEmailCode();
  const codeHash = hashEmailCode(email, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.emailVerification.create({
    data: { userId, email, codeHash, expiresAt }
  });

  try {
    await sendEmailVerificationCode(email, code);
  } catch (error) {
    request.log.error({ error }, 'Email verification delivery failed');
    return reply.code(503).send({ error: 'EMAIL_DELIVERY_FAILED' });
  }

  return { status: 'CODE_SENT', expiresInSeconds: 600 };
});

const emailConfirmSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()),
  code: z.string().regex(/^\d{6}$/)
});

app.post('/v1/me/email/confirm', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = emailConfirmSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CODE' });

  const { email, code } = parsed.data;
  const record = await prisma.emailVerification.findFirst({
    where: { userId, email, consumedAt: null },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) return reply.code(404).send({ error: 'VERIFICATION_NOT_FOUND' });
  if (record.expiresAt < new Date()) return reply.code(410).send({ error: 'CODE_EXPIRED' });
  if (record.attempts >= 5) return reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS' });

  if (!emailCodeMatches(email, code, record.codeHash)) {
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });
    return reply.code(400).send({ error: 'INVALID_CODE' });
  }

  try {
    await prisma.$transaction([
      prisma.emailVerification.update({
        where: { id: record.id },
        data: { consumedAt: new Date() }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { email, emailVerifiedAt: new Date() }
      })
    ]);
  } catch (error) {
    request.log.warn({ error }, 'Email confirmation conflict');
    return reply.code(409).send({ error: 'EMAIL_ALREADY_IN_USE' });
  }

  return { status: 'VERIFIED', email };
});

const regionSchema = z.object({
  voivodeship: z.enum(VOIVODESHIPS),
  city: z.string().min(2).max(120),
  municipality: z.string().min(2).max(120).optional(),
  county: z.string().min(2).max(120).optional(),
  postalCode: z.string().regex(/^\d{2}-\d{3}$/).optional(),
  terytMunicipalityCode: z.string().min(4).max(7).optional(),
  terytLocalityCode: z.string().min(1).max(12).optional()
});

app.put('/v1/me/region', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = regionSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_REGION',
      details: parsed.error.flatten()
    });
  }

  const requested = parsed.data;
  const now = new Date();

  let region = {
    voivodeship: requested.voivodeship,
    city: requested.city,
    municipality: requested.municipality,
    county: requested.county,
    postalCode: requested.postalCode
  };

  let terytMunicipalityCode: string | null = null;
  let terytLocalityCode: string | null = null;
  let terytVerified = false;
  let terytVerifiedAt: Date | null = null;

  if (requested.terytMunicipalityCode) {
    const municipality = await prisma.terytMunicipality.findUnique({
      where: { tercCode: requested.terytMunicipalityCode }
    });

    if (
      !municipality ||
      municipality.voivodeship !== requested.voivodeship ||
      (municipality.validTo && municipality.validTo < now)
    ) {
      return reply.code(409).send({ error: 'TERYT_MUNICIPALITY_NOT_VERIFIED' });
    }

    let localityName = requested.city;

    if (requested.terytLocalityCode) {
      const locality = await prisma.terytLocality.findFirst({
        where: {
          simcCode: requested.terytLocalityCode,
          municipalityTercCode: municipality.tercCode
        }
      });

      if (!locality) {
        return reply.code(409).send({ error: 'TERYT_LOCALITY_NOT_VERIFIED' });
      }

      localityName = locality.name;
      terytLocalityCode = locality.simcCode;
    }

    region = {
      voivodeship: municipality.voivodeship as typeof requested.voivodeship,
      city: localityName,
      municipality: municipality.municipality,
      county: municipality.county ?? undefined,
      postalCode: requested.postalCode
    };

    terytMunicipalityCode = municipality.tercCode;
    terytVerified = true;
    terytVerifiedAt = now;
  }

  const assignments = await prisma.regionAssignment.findMany({
    where: {
      voivodeship: region.voivodeship,
      OR: [
        ...(region.municipality
          ? [{ municipality: { equals: region.municipality, mode: 'insensitive' as const } }]
          : []),
        { city: { equals: region.city, mode: 'insensitive' as const } },
        ...(region.county
          ? [{ county: { equals: region.county, mode: 'insensitive' as const } }]
          : [])
      ],
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] }
      ]
    },
    select: {
      institutionId: true,
      role: true,
      verifiedAt: true,
      sourceUrl: true
    }
  });

  const pup = assignments.find((a) => a.role === 'PUP');
  const wup = assignments.find((a) => a.role === 'WUP');
  const lgd = assignments.find((a) => a.role === 'LGD');

  const profileData = {
    ...region,
    pupOfficeId: pup?.institutionId ?? null,
    wupOfficeId: wup?.institutionId ?? null,
    lgdId: lgd?.institutionId ?? null,
    regionVerified: Boolean(pup || wup || lgd),
    regionSource: pup?.sourceUrl ?? wup?.sourceUrl ?? lgd?.sourceUrl ?? null,
    terytMunicipalityCode,
    terytLocalityCode,
    terytVerified,
    terytVerifiedAt
  };

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: profileData,
    create: {
      userId,
      ...profileData
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'REGION_PROFILE_UPDATED',
      entity: 'UserProfile',
      entityId: profile.id,
      metadata: {
        requested,
        canonical: region,
        terytVerified,
        pupOfficeId: pup?.institutionId ?? null
      }
    }
  });

  return {
    profile,
    routing: {
      pupOfficeId: pup?.institutionId ?? null,
      wupOfficeId: wup?.institutionId ?? null,
      lgdId: lgd?.institutionId ?? null,
      verified: profile.regionVerified,
      terytVerified: profile.terytVerified
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



const selectFundingCallSchema = z.object({
  fundingCallId: z.string().min(1)
});

app.post('/v1/cases/:caseId/select-call', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = selectFundingCallSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_FUNDING_CALL_SELECTION' });
  }

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    include: {
      user: {
        include: { profile: true }
      },
      documents: { select: { id: true }, take: 1 },
      renderJobs: {
        where: { status: { in: ['QUEUED', 'PROCESSING', 'COMPLETED'] } },
        select: { id: true },
        take: 1
      }
    }
  });

  if (!item) {
    return reply.code(404).send({ error: 'CASE_NOT_FOUND' });
  }

  if (item.submittedAt || item.documents.length > 0 || item.renderJobs.length > 0) {
    return reply.code(409).send({ error: 'CASE_CALL_LOCKED_BY_DOCUMENTS' });
  }

  const pupOfficeId = item.user.profile?.pupOfficeId;
  if (!pupOfficeId) {
    return reply.code(409).send({ error: 'VERIFIED_PUP_ROUTING_REQUIRED' });
  }

  const now = new Date();
  const call = await prisma.fundingCall.findFirst({
    where: {
      id: parsed.data.fundingCallId,
      institutionId: pupOfficeId,
      verificationStatus: 'VERIFIED',
      verifiedAt: { not: null },
      status: { in: ['ANNOUNCED', 'OPEN'] },
      OR: [
        { closesAt: null },
        { closesAt: { gte: now } }
      ]
    },
    include: {
      criterionSets: {
        where: {
          status: 'VERIFIED',
          verifiedAt: { not: null }
        },
        orderBy: { verifiedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          title: true,
          minimumPoints: true,
          maximumPoints: true,
          sourceHash: true
        }
      },
      formTemplates: {
        where: {
          active: true,
          officialOnly: true,
          mappingStatus: 'VERIFIED'
        },
        orderBy: { mappingVerifiedAt: 'desc' },
        select: {
          id: true,
          formCode: true,
          versionLabel: true,
          mappingVersion: true
        }
      }
    }
  });

  if (!call) {
    return reply.code(409).send({ error: 'FUNDING_CALL_NOT_AVAILABLE_FOR_CASE' });
  }

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: {
      fundingCallId: call.id,
      caseType: 'PUP_STARTUP',
      status: 'CALL_SELECTED'
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'FUNDING_CALL_SELECTED',
      entity: 'Case',
      entityId: caseId,
      metadata: {
        fundingCallId: call.id,
        institutionId: call.institutionId,
        verifiedAt: call.verifiedAt,
        sourceHash: call.sourceHash
      }
    }
  });

  return {
    case: updated,
    fundingCall: {
      id: call.id,
      title: call.title,
      status: call.status,
      opensAt: call.opensAt,
      closesAt: call.closesAt,
      officialUrl: call.officialUrl,
      criterionSet: call.criterionSets[0] ?? null,
      formTemplates: call.formTemplates
    }
  };
});

app.post('/v1/cases/:caseId/qualify', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    include: {
      user: {
        include: {
          profile: true,
          fundingProfile: true
        }
      }
    }
  });

  if (!item) {
    return reply.code(404).send({ error: 'CASE_NOT_FOUND' });
  }

  const profile = item.user.profile;
  const funding = item.user.fundingProfile;

  const pup = qualifyPupStartup({
    employmentStatus: funding?.employmentStatus,
    wantsToStartBusiness: funding?.wantsToStartBusiness,
    voivodeship: profile?.voivodeship,
    municipality: profile?.municipality,
    regionVerified: profile?.regionVerified,
    pupOfficeId: profile?.pupOfficeId,
    businessActiveLast12Months: funding?.businessActiveLast12Months,
    priorNonRepayableStartupAid: funding?.priorNonRepayableStartupAid
  });

  const activeCalls = profile?.pupOfficeId
    ? await prisma.fundingCall.findMany({
        where: {
          institutionId: profile.pupOfficeId,
          verificationStatus: 'VERIFIED',
          verifiedAt: { not: null },
          status: { in: ['OPEN', 'ANNOUNCED'] },
          OR: [
            { closesAt: null },
            { closesAt: { gte: new Date() } }
          ]
        },
        include: {
          criterionSets: {
            where: {
              status: 'VERIFIED',
              verifiedAt: { not: null }
            },
            orderBy: { verifiedAt: 'desc' },
            take: 1,
            include: {
              criteria: { orderBy: { sortOrder: 'asc' } },
              sourceDocument: {
                include: {
                  source: {
                    select: {
                      canonicalUrl: true,
                      displayName: true
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: [{ opensAt: 'asc' }, { closesAt: 'asc' }],
        take: 20
      })
    : [];

  const sourceRefs = [
    ...pup.sourceRefs,
    ...(profile?.regionSource
      ? [{
          sourceId: 'REGIONAL-PUP-ROUTING',
          sourceVersionId: profile.regionSource,
          url: profile.regionSource
        }]
      : []),
    ...activeCalls
      .filter((call) => call.officialUrl)
      .map((call) => ({
        sourceId: `FUNDING-CALL:${call.id}`,
        sourceVersionId: call.verifiedAt?.toISOString() ?? 'UNVERIFIED',
        url: call.officialUrl ?? undefined
      }))
  ];

  const result = {
    engineVersion: QUALIFICATION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    caseId,
    paths: [{
      ...pup,
      activeCalls: activeCalls.map((call) => ({
        id: call.id,
        title: call.title,
        status: call.status,
        opensAt: call.opensAt,
        closesAt: call.closesAt,
        untilExhausted: call.untilExhausted,
        officialUrl: call.officialUrl,
        verifiedAt: call.verifiedAt,
        localCriteria: call.criterionSets[0] ? {
          id: call.criterionSets[0].id,
          title: call.criterionSets[0].title,
          minimumPoints: call.criterionSets[0].minimumPoints,
          maximumPoints: call.criterionSets[0].maximumPoints,
          sourceHash: call.criterionSets[0].sourceHash,
          officialSourceUrl: call.criterionSets[0].sourceDocument.source.canonicalUrl,
          questions: buildLocalCriterionQuestions(
            call.criterionSets[0].criteria.map((criterion) => ({
              code: criterion.code,
              title: criterion.title,
              description: criterion.description,
              maxPoints: criterion.maxPoints,
              failIfZero: criterion.failIfZero,
              scoringJson: criterion.scoringJson,
              evidenceHint: criterion.evidenceHint
            }))
          )
        } : null
      }))
    }]
  };

  const snapshot = await prisma.qualificationSnapshot.create({
    data: {
      caseId,
      status: pup.status,
      engineVersion: QUALIFICATION_ENGINE_VERSION,
      resultJson: result as never,
      sourceRefs: sourceRefs as never
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'SYSTEM',
      action: 'CASE_QUALIFIED',
      entity: 'QualificationSnapshot',
      entityId: snapshot.id,
      metadata: {
        caseId,
        engineVersion: QUALIFICATION_ENGINE_VERSION,
        primaryStatus: pup.status
      }
    }
  });

  return {
    snapshotId: snapshot.id,
    ...result
  };
});


app.get('/v1/cases/:caseId/qualification/latest', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    select: { id: true }
  });
  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });

  const snapshot = await prisma.qualificationSnapshot.findFirst({
    where: { caseId },
    orderBy: { createdAt: 'desc' }
  });

  return { snapshot };
});


const localCriteriaQuerySchema = z.object({
  criterionSetId: z.string().min(1)
});

function criterionSetToRuleDefinition(set: {
  id: string;
  version: number;
  sourceHash: string;
  minimumPoints: number | null;
  maximumPoints: number | null;
  criteria: Array<{
    code: string;
    title: string;
    description: string | null;
    maxPoints: number | null;
    failIfZero: boolean;
    scoringJson: unknown;
    evidenceHint: string | null;
  }>;
}) {
  return {
    id: set.id,
    version: set.version,
    sourceHash: set.sourceHash,
    minimumPoints: set.minimumPoints,
    maximumPoints: set.maximumPoints,
    criteria: set.criteria.map((criterion) => ({
      code: criterion.code,
      title: criterion.title,
      description: criterion.description,
      maxPoints: criterion.maxPoints,
      failIfZero: criterion.failIfZero,
      scoringJson: criterion.scoringJson,
      evidenceHint: criterion.evidenceHint
    }))
  };
}

async function getVerifiedCriterionSetForCase(
  caseId: string,
  userId: string,
  criterionSetId: string
) {
  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    include: {
      user: {
        include: {
          profile: true
        }
      }
    }
  });

  if (!item) return { error: 'CASE_NOT_FOUND' as const };

  const set = await prisma.localCriterionSet.findFirst({
    where: {
      id: criterionSetId,
      status: 'VERIFIED',
      verifiedAt: { not: null }
    },
    include: {
      criteria: { orderBy: { sortOrder: 'asc' } },
      sourceDocument: {
        include: {
          source: {
            select: {
              canonicalUrl: true,
              displayName: true
            }
          }
        }
      },
      fundingCall: true
    }
  });

  if (!set) return { error: 'VERIFIED_CRITERION_SET_NOT_FOUND' as const };

  if (set.sourceHash !== set.sourceDocument.sha256) {
    return { error: 'CRITERIA_SOURCE_HASH_MISMATCH' as const };
  }

  const profile = item.user.profile;
  if (!profile?.pupOfficeId || set.institutionId !== profile.pupOfficeId) {
    return { error: 'CRITERION_SET_NOT_FOR_USERS_PUP' as const };
  }

  if (set.fundingCall) {
    if (!item.fundingCallId || item.fundingCallId !== set.fundingCall.id) {
      return { error: 'FUNDING_CALL_SELECTION_REQUIRED_OR_MISMATCH' as const };
    }

    if (
      set.fundingCall.verificationStatus !== 'VERIFIED' ||
      !set.fundingCall.verifiedAt ||
      !['ANNOUNCED', 'OPEN'].includes(set.fundingCall.status)
    ) {
      return { error: 'FUNDING_CALL_NOT_ACTIVE_OR_VERIFIED' as const };
    }

    const now = new Date();
    if (set.fundingCall.closesAt && set.fundingCall.closesAt < now) {
      return { error: 'FUNDING_CALL_CLOSED' as const };
    }
  }

  return { item, set };
}

app.get('/v1/cases/:caseId/local-criteria', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = localCriteriaQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'CRITERION_SET_ID_REQUIRED' });
  }

  const resolved = await getVerifiedCriterionSetForCase(
    caseId,
    userId,
    parsed.data.criterionSetId
  );

  if ('error' in resolved) {
    const statusCode = resolved.error === 'CASE_NOT_FOUND' ? 404 : 409;
    return reply.code(statusCode).send({ error: resolved.error });
  }

  const definition = criterionSetToRuleDefinition(resolved.set);
  const questions = buildLocalCriterionQuestions(definition.criteria);

  const latest = await prisma.criterionAssessmentSnapshot.findFirst({
    where: {
      caseId,
      criterionSetId: resolved.set.id
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    criterionSet: {
      id: resolved.set.id,
      title: resolved.set.title,
      version: resolved.set.version,
      minimumPoints: resolved.set.minimumPoints,
      maximumPoints: resolved.set.maximumPoints,
      sourceHash: resolved.set.sourceHash,
      officialSourceUrl: resolved.set.sourceDocument.source.canonicalUrl,
      sourceDocumentName: resolved.set.sourceDocument.originalName,
      fundingCall: resolved.set.fundingCall ? {
        id: resolved.set.fundingCall.id,
        title: resolved.set.fundingCall.title,
        status: resolved.set.fundingCall.status,
        opensAt: resolved.set.fundingCall.opensAt,
        closesAt: resolved.set.fundingCall.closesAt
      } : null
    },
    questions,
    latestAssessment: latest ? {
      id: latest.id,
      status: latest.status,
      answers: latest.answersJson,
      result: latest.resultJson,
      createdAt: latest.createdAt
    } : null
  };
});

const localCriteriaAssessmentSchema = z.object({
  criterionSetId: z.string().min(1),
  answers: z.record(
    z.string().min(1).max(120),
    z.union([
      z.string().max(5000),
      z.number(),
      z.boolean(),
      z.null()
    ])
  )
});

app.post('/v1/cases/:caseId/local-criteria/assess', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = localCriteriaAssessmentSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_LOCAL_CRITERIA_ANSWERS',
      details: parsed.error.flatten()
    });
  }

  const resolved = await getVerifiedCriterionSetForCase(
    caseId,
    userId,
    parsed.data.criterionSetId
  );

  if ('error' in resolved) {
    const statusCode = resolved.error === 'CASE_NOT_FOUND' ? 404 : 409;
    return reply.code(statusCode).send({ error: resolved.error });
  }

  const definition = criterionSetToRuleDefinition(resolved.set);
  const allowedCodes = new Set(definition.criteria.map((criterion) => criterion.code));
  const sanitizedAnswers = Object.fromEntries(
    Object.entries(parsed.data.answers)
      .filter(([code]) => allowedCodes.has(code))
  );

  const result = assessLocalCriteria(
    definition,
    sanitizedAnswers
  );

  const snapshot = await prisma.criterionAssessmentSnapshot.create({
    data: {
      caseId,
      criterionSetId: resolved.set.id,
      status: result.status,
      answersJson: sanitizedAnswers as never,
      resultJson: result as never
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'LOCAL_CRITERIA_ASSESSED',
      entity: 'CriterionAssessmentSnapshot',
      entityId: snapshot.id,
      metadata: {
        caseId,
        criterionSetId: resolved.set.id,
        criterionSetVersion: resolved.set.version,
        sourceHash: resolved.set.sourceHash,
        status: result.status,
        knownPoints: result.knownPoints,
        possiblePoints: result.possiblePoints
      }
    }
  });

  return {
    snapshotId: snapshot.id,
    result
  };
});


app.post('/v1/cases/:caseId/package', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    include: {
      user: {
        select: {
          email: true,
          emailVerifiedAt: true
        }
      },
      fundingCall: {
        include: {
          institution: {
            select: {
              name: true,
              officialUrl: true
            }
          }
        }
      }
    }
  });

  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });
  if (!item.user.email || !item.user.emailVerifiedAt) {
    return reply.code(409).send({ error: 'VERIFIED_EMAIL_REQUIRED' });
  }
  if (!item.fundingCallId || !item.fundingCall) {
    return reply.code(409).send({ error: 'FUNDING_CALL_SELECTION_REQUIRED' });
  }
  if (
    item.fundingCall.verificationStatus !== 'VERIFIED' ||
    !item.fundingCall.verifiedAt
  ) {
    return reply.code(409).send({ error: 'VERIFIED_FUNDING_CALL_REQUIRED' });
  }

  const instruction = await prisma.submissionInstructionVersion.findFirst({
    where: {
      fundingCallId: item.fundingCallId,
      status: 'VERIFIED',
      verifiedAt: { not: null }
    },
    orderBy: [
      { verifiedAt: 'desc' },
      { version: 'desc' }
    ]
  });

  if (!instruction) {
    return reply.code(409).send({ error: 'VERIFIED_SUBMISSION_INSTRUCTION_REQUIRED' });
  }

  const requiredTemplates = await prisma.officialFormTemplate.findMany({
    where: {
      fundingCallId: item.fundingCallId,
      active: true,
      officialOnly: true,
      requiredForPackage: true,
      mappingStatus: 'VERIFIED',
      mappingVerifiedAt: { not: null }
    },
    select: {
      id: true,
      formCode: true,
      sourceDocument: {
        select: { originalName: true }
      }
    }
  });

  if (requiredTemplates.length === 0) {
    return reply.code(409).send({ error: 'NO_VERIFIED_REQUIRED_FORMS' });
  }

  const completedJobs = await prisma.documentRenderJob.findMany({
    where: {
      caseId,
      status: 'COMPLETED',
      templateId: { in: requiredTemplates.map((template) => template.id) },
      outputStorageKey: { not: null }
    },
    select: {
      templateId: true,
      outputStorageKey: true
    }
  });

  const completedTemplateIds = new Set(completedJobs.map((job) => job.templateId));
  const missing = requiredTemplates
    .filter((template) => !completedTemplateIds.has(template.id))
    .map((template) => ({
      templateId: template.id,
      formCode: template.formCode,
      name: template.sourceDocument.originalName
    }));

  if (missing.length > 0) {
    return reply.code(409).send({
      error: 'PACKAGE_REQUIRED_DOCUMENTS_MISSING',
      missing
    });
  }

  const existingJob = await prisma.documentPackageJob.findFirst({
    where: {
      caseId,
      status: { in: ['QUEUED', 'PROCESSING'] }
    },
    orderBy: { requestedAt: 'desc' }
  });

  if (existingJob) {
    return reply.code(202).send({ job: existingJob, reused: true });
  }

  const job = await prisma.documentPackageJob.create({
    data: {
      caseId,
      submissionInstructionId: instruction.id,
      status: 'QUEUED',
      recipientEmail: item.user.email
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'DOCUMENT_PACKAGE_REQUESTED',
      entity: 'DocumentPackageJob',
      entityId: job.id,
      metadata: {
        caseId,
        fundingCallId: item.fundingCallId,
        submissionInstructionId: instruction.id,
        recipientEmailVerified: true,
        requiredForms: requiredTemplates.map((template) => template.id)
      }
    }
  });

  return reply.code(202).send({ job, reused: false });
});

app.get('/v1/cases/:caseId/package/:jobId', async (request, reply) => {
  const userId = await requireUserId(request);
  const { caseId, jobId } = request.params as { caseId: string; jobId: string };

  const job = await prisma.documentPackageJob.findFirst({
    where: {
      id: jobId,
      caseId,
      case: { userId }
    },
    select: {
      id: true,
      status: true,
      outputName: true,
      errorCode: true,
      requestedAt: true,
      startedAt: true,
      completedAt: true
    }
  });

  if (!job) {
    return reply.code(404).send({ error: 'PACKAGE_JOB_NOT_FOUND' });
  }

  return { job };
});

app.get('/v1/me/dashboard', async (request) => {
  const userId = await requireUserId(request);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      fundingProfile: true,
      notificationPreference: true,
      cases: {
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: {
          qualifications: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      },
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




async function buildResolvedCaseValues(caseId: string, userId: string) {
  const [user, answers] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true, fundingProfile: true }
    }),
    prisma.caseAnswer.findMany({
      where: { caseId },
      orderBy: [{ fieldKey: 'asc' }, { version: 'desc' }]
    })
  ]);

  const values: Record<string, unknown> = {
    'user.email': user.email,
    'user.firstName': user.telegramFirstName,
    'user.lastName': user.telegramLastName,
    'profile.voivodeship': user.profile?.voivodeship,
    'profile.county': user.profile?.county,
    'profile.municipality': user.profile?.municipality,
    'profile.city': user.profile?.city,
    'profile.postalCode': user.profile?.postalCode,
    'funding.employmentStatus': user.fundingProfile?.employmentStatus,
    'funding.plannedLegalForm': user.fundingProfile?.plannedLegalForm,
    'funding.plannedBusinessDescription': user.fundingProfile?.plannedBusinessDescription,
    'funding.plannedPkd': user.fundingProfile?.plannedPkd
  };

  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.fieldKey)) continue;
    values[answer.fieldKey] = answer.valueJson;
    seen.add(answer.fieldKey);
  }

  return values;
}

function valueIsPresent(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}



app.get('/v1/cases/:caseId/official-forms', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    select: {
      id: true,
      fundingCallId: true,
      fundingCall: {
        select: {
          id: true,
          title: true,
          status: true,
          verificationStatus: true,
          verifiedAt: true,
          closesAt: true
        }
      }
    }
  });

  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });
  if (!item.fundingCallId || !item.fundingCall) {
    return reply.code(409).send({ error: 'FUNDING_CALL_SELECTION_REQUIRED' });
  }

  if (
    item.fundingCall.verificationStatus !== 'VERIFIED' ||
    !item.fundingCall.verifiedAt
  ) {
    return reply.code(409).send({ error: 'VERIFIED_FUNDING_CALL_REQUIRED' });
  }

  const templates = await prisma.officialFormTemplate.findMany({
    where: {
      fundingCallId: item.fundingCallId,
      active: true,
      officialOnly: true,
      mappingStatus: 'VERIFIED',
      mappingVerifiedAt: { not: null }
    },
    include: {
      sourceDocument: {
        include: {
          source: {
            select: {
              canonicalUrl: true,
              displayName: true
            }
          }
        }
      }
    },
    orderBy: [
      { formCode: 'asc' },
      { mappingVersion: 'desc' }
    ]
  });

  return {
    fundingCall: item.fundingCall,
    forms: templates.map((template) => ({
      id: template.id,
      formCode: template.formCode,
      versionLabel: template.versionLabel,
      mappingVersion: template.mappingVersion,
      originalName: template.sourceDocument.originalName,
      mimeType: template.sourceDocument.mimeType,
      sha256: template.sourceDocument.sha256,
      officialSourceUrl: template.sourceDocument.source.canonicalUrl,
      officialSourceName: template.sourceDocument.source.displayName
    }))
  };
});

app.get('/v1/cases/:caseId/form-questions', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const query = z.object({ templateId: z.string().min(1) }).safeParse(request.query);
  if (!query.success) return reply.code(400).send({ error: 'TEMPLATE_ID_REQUIRED' });

  const [item, template] = await Promise.all([
    prisma.case.findFirst({
      where: { id: caseId, userId },
      select: { id: true, fundingCallId: true }
    }),
    prisma.officialFormTemplate.findFirst({
      where: {
        id: query.data.templateId,
        active: true,
        officialOnly: true,
        mappingStatus: 'VERIFIED'
      },
      include: {
        fieldMappings: { orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }] },
        sourceDocument: {
          include: { source: { select: { canonicalUrl: true, displayName: true } } }
        }
      }
    })
  ]);

  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });
  if (!template) return reply.code(404).send({ error: 'VERIFIED_TEMPLATE_NOT_FOUND' });

  if (template.fundingCallId && template.fundingCallId !== item.fundingCallId) {
    return reply.code(409).send({ error: 'FORM_TEMPLATE_FUNDING_CALL_MISMATCH' });
  }
  if (item.fundingCallId && !template.fundingCallId) {
    return reply.code(409).send({ error: 'CALL_SPECIFIC_FORM_REQUIRED' });
  }

  const values = await buildResolvedCaseValues(caseId, userId);

  return {
    template: {
      id: template.id,
      versionLabel: template.versionLabel,
      mappingVersion: template.mappingVersion,
      originalName: template.sourceDocument.originalName,
      officialSourceUrl: template.sourceDocument.source.canonicalUrl,
      sha256: template.sourceDocument.sha256
    },
    questions: template.fieldMappings.map((mapping) => ({
      fieldKey: mapping.fieldKey,
      label: mapping.questionLabel ?? mapping.fieldKey,
      section: mapping.section,
      inputType: mapping.inputType,
      required: mapping.required,
      helpText: mapping.helpText,
      validation: mapping.validationJson,
      value: values[mapping.fieldKey] ?? null
    }))
  };
});

const caseAnswersSchema = z.object({
  answers: z.array(z.object({
    fieldKey: z.string().min(1).max(240),
    value: z.unknown()
  })).min(1).max(100)
});

app.put('/v1/cases/:caseId/answers', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = caseAnswersSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_CASE_ANSWERS', details: parsed.error.flatten() });
  }

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId }
  });
  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });

  const uniqueAnswers = new Map<string, unknown>();
  for (const answer of parsed.data.answers) {
    uniqueAnswers.set(answer.fieldKey, answer.value);
  }

  const saved = [];
  for (const [fieldKey, value] of uniqueAnswers.entries()) {
    const latest = await prisma.caseAnswer.findFirst({
      where: { caseId, fieldKey },
      orderBy: { version: 'desc' },
      select: { version: true, valueJson: true }
    });

    const record = await prisma.caseAnswer.create({
      data: {
        caseId,
        fieldKey,
        valueJson: value as never,
        version: (latest?.version ?? 0) + 1
      }
    });
    saved.push(record);
  }

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'CASE_ANSWERS_UPDATED',
      entity: 'Case',
      entityId: caseId,
      metadata: { fieldKeys: [...uniqueAnswers.keys()] }
    }
  });

  return { saved: saved.length };
});


app.get('/v1/cases/:caseId/render-jobs/:jobId', async (request, reply) => {
  const userId = await requireUserId(request);
  const { caseId, jobId } = request.params as { caseId: string; jobId: string };

  const job = await prisma.documentRenderJob.findFirst({
    where: {
      id: jobId,
      caseId,
      case: { userId }
    },
    select: {
      id: true,
      status: true,
      outputName: true,
      outputMimeType: true,
      errorCode: true,
      requestedAt: true,
      startedAt: true,
      completedAt: true,
      template: {
        select: {
          id: true,
          formCode: true,
          versionLabel: true,
          sourceDocument: {
            select: {
              originalName: true,
              sha256: true
            }
          }
        }
      }
    }
  });

  if (!job) {
    return reply.code(404).send({ error: 'DOCUMENT_JOB_NOT_FOUND' });
  }

  return {
    job: {
      id: job.id,
      status: job.status,
      outputName: job.outputName,
      outputMimeType: job.outputMimeType,
      errorCode: job.errorCode,
      requestedAt: job.requestedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      template: job.template
    }
  };
});

const renderRequestSchema = z.object({
  templateId: z.string().min(1)
});

app.post('/v1/cases/:caseId/render', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = renderRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RENDER_REQUEST' });

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId },
    select: {
      id: true,
      status: true,
      fundingCallId: true
    }
  });
  if (!item) return reply.code(404).send({ error: 'CASE_NOT_FOUND' });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true }
  });
  if (!user?.emailVerifiedAt) {
    return reply.code(409).send({ error: 'VERIFIED_EMAIL_REQUIRED' });
  }

  const template = await prisma.officialFormTemplate.findFirst({
    where: {
      id: parsed.data.templateId,
      active: true,
      officialOnly: true,
      mappingStatus: 'VERIFIED'
    },
    include: {
      fieldMappings: { orderBy: { sortOrder: 'asc' } },
      sourceDocument: true
    }
  });
  if (!template) {
    return reply.code(409).send({ error: 'VERIFIED_OFFICIAL_TEMPLATE_REQUIRED' });
  }

  if (template.fundingCallId && template.fundingCallId !== item.fundingCallId) {
    return reply.code(409).send({ error: 'FORM_TEMPLATE_FUNDING_CALL_MISMATCH' });
  }
  if (item.fundingCallId && !template.fundingCallId) {
    return reply.code(409).send({ error: 'CALL_SPECIFIC_FORM_REQUIRED' });
  }

  const values = await buildResolvedCaseValues(caseId, userId);
  const missing = template.fieldMappings
    .filter((mapping) => mapping.required && !valueIsPresent(values[mapping.fieldKey]))
    .map((mapping) => ({
      fieldKey: mapping.fieldKey,
      label: mapping.questionLabel ?? mapping.fieldKey
    }));

  if (missing.length > 0) {
    return reply.code(409).send({
      error: 'REQUIRED_FORM_DATA_MISSING',
      missing
    });
  }

  const existing = await prisma.documentRenderJob.findFirst({
    where: {
      caseId,
      templateId: template.id,
      status: { in: ['QUEUED', 'PROCESSING'] }
    },
    orderBy: { requestedAt: 'desc' }
  });
  if (existing) return { job: existing, reused: true };

  const job = await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        formTemplateId: template.id,
        status: item.status === 'QUALIFICATION' ? 'APPLICATION_PREPARATION' : item.status
      }
    });

    return tx.documentRenderJob.create({
      data: {
        caseId,
        templateId: template.id,
        status: 'QUEUED'
      }
    });
  });

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: 'USER',
      action: 'OFFICIAL_FORM_RENDER_REQUESTED',
      entity: 'DocumentRenderJob',
      entityId: job.id,
      metadata: {
        caseId,
        templateId: template.id,
        sourceDocumentId: template.sourceDocumentId,
        sourceSha256: template.sourceDocument.sha256
      }
    }
  });

  return reply.code(202).send({ job, reused: false });
});

const notificationPreferenceSchema = z.object({
  morningDigest: z.boolean().optional(),
  criticalAlerts: z.boolean().optional(),
  newCalls: z.boolean().optional(),
  legalChanges: z.boolean().optional(),
  caseChanges: z.boolean().optional(),
  marketing: z.boolean().optional(),
  telegramWriteAccess: z.boolean().optional()
});

app.put('/v1/me/notifications', async (request, reply) => {
  const userId = await requireUserId(request);
  const parsed = notificationPreferenceSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_NOTIFICATION_PREFERENCES' });
  }

  const preferences = await prisma.notificationPreference.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data }
  });

  return { preferences };
});


function requireWorkerSecret(request: FastifyRequest) {
  const configured = process.env.INTERNAL_WORKER_SECRET;
  const received = request.headers['x-worker-secret'];
  if (!configured || typeof received !== 'string') {
    throw Object.assign(new Error('Unauthorized worker'), { statusCode: 401 });
  }

  const a = Buffer.from(configured);
  const b = Buffer.from(received);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Unauthorized worker'), { statusCode: 401 });
  }
}

app.get('/v1/internal/sources', async (request) => {
  requireWorkerSecret(request);
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: [{ trustLevel: 'asc' }, { canonicalUrl: 'asc' }],
    select: {
      id: true,
      kind: true,
      canonicalUrl: true,
      displayName: true,
      discoveredFromUrl: true,
      trustLevel: true,
      contentHash: true,
      etag: true,
      lastModified: true,
      checkedAt: true,
      scopeVoivodeship: true,
      scopeCounty: true,
      scopeMunicipality: true
    }
  });
  return { sources };
});

const sourceScanSchema = z.object({
  sourceId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  statusCode: z.number().int().min(100).max(599),
  etag: z.string().max(1000).optional(),
  lastModified: z.string().max(1000).optional(),
  scannedAt: z.string().datetime()
});

app.post('/v1/internal/source-scan', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = sourceScanSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_SCAN_REPORT', details: parsed.error.flatten() });
  }

  const report = parsed.data;
  const source = await prisma.source.findUnique({ where: { id: report.sourceId } });
  if (!source) return reply.code(404).send({ error: 'SOURCE_NOT_FOUND' });

  const previousHash = source.contentHash;
  const changed = Boolean(previousHash && previousHash !== report.sha256);

  const updated = await prisma.source.update({
    where: { id: source.id },
    data: {
      contentHash: report.sha256,
      etag: report.etag ?? null,
      lastModified: report.lastModified ?? null,
      lastStatusCode: report.statusCode,
      checkedAt: new Date(report.scannedAt)
    }
  });

  let changeEventId: string | null = null;
  if (changed) {
    const event = await prisma.changeEvent.create({
      data: {
        sourceId: source.id,
        changeType: 'SOURCE_CONTENT_CHANGED',
        severity: source.kind === 'OFFICIAL_FORM' || source.kind === 'LEGAL_ACT' ? 'YELLOW' : 'INFORMATION',
        summary: `Wykryto zmianę w oficjalnym źródle: ${source.canonicalUrl}`,
        verified: false,
        payload: {
          previousHash,
          currentHash: report.sha256,
          sourceKind: source.kind,
          sourceUrl: source.canonicalUrl,
          scopeVoivodeship: source.scopeVoivodeship,
          scopeCounty: source.scopeCounty,
          scopeMunicipality: source.scopeMunicipality
        }
      }
    });
    changeEventId = event.id;
  }

  return {
    sourceId: updated.id,
    baselineCreated: previousHash === null,
    changed,
    changeEventId
  };
});



const pupDirectoryImportSchema = z.object({
  sourceUrl: z.string().url(),
  voivodeship: z.enum(VOIVODESHIPS),
  offices: z.array(z.object({
    name: z.string().min(3).max(300),
    officialUrl: z.string().url(),
    municipalities: z.array(z.string().min(1).max(160)).min(1)
  })).min(1).max(200)
});

app.post('/v1/internal/pup-directory/import', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = pupDirectoryImportSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_PUP_DIRECTORY', details: parsed.error.flatten() });
  }

  const { sourceUrl, voivodeship, offices } = parsed.data;
  const now = new Date();
  let institutionsUpserted = 0;
  let assignmentsUpserted = 0;

  for (const office of offices) {
    const url = new URL(office.officialUrl);
    const code = `PUP:${url.hostname.toLowerCase()}`;

    const institution = await prisma.institution.upsert({
      where: { code },
      update: {
        type: 'PUP',
        name: office.name,
        voivodeship,
        officialUrl: office.officialUrl
      },
      create: {
        code,
        type: 'PUP',
        name: office.name,
        voivodeship,
        officialUrl: office.officialUrl
      }
    });
    institutionsUpserted++;

    await prisma.source.upsert({
      where: { canonicalUrl: office.officialUrl },
      update: {
        institutionId: institution.id,
        kind: 'PUP_HOME',
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: voivodeship
      },
      create: {
        institutionId: institution.id,
        kind: 'PUP_HOME',
        canonicalUrl: office.officialUrl,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: voivodeship
      }
    });

    const uniqueMunicipalities = [...new Set(
      office.municipalities
        .map((name) => name.trim().replace(/[.;]+$/, ''))
        .filter(Boolean)
    )];

    for (const municipality of uniqueMunicipalities) {
      await prisma.regionAssignment.upsert({
        where: {
          institutionId_role_voivodeship_municipality: {
            institutionId: institution.id,
            role: 'PUP',
            voivodeship,
            municipality
          }
        },
        update: {
          city: municipality,
          sourceUrl,
          verifiedAt: now,
          validTo: null
        },
        create: {
          institutionId: institution.id,
          role: 'PUP',
          voivodeship,
          municipality,
          city: municipality,
          sourceUrl,
          verifiedAt: now
        }
      });
      assignmentsUpserted++;
    }
  }

  await prisma.auditEvent.create({
    data: {
      actorType: 'SYSTEM',
      action: 'PUP_DIRECTORY_IMPORTED',
      entity: 'RegionAssignment',
      metadata: {
        sourceUrl,
        voivodeship,
        offices: institutionsUpserted,
        assignments: assignmentsUpserted
      }
    }
  });

  return {
    voivodeship,
    institutionsUpserted,
    assignmentsUpserted
  };
});



function classifyOfficialAttachment(name: string, url: string) {
  const value = `${name} ${url}`.toLowerCase();
  if (value.includes('regulamin') || value.includes('zasady')) return 'REGULATION';
  if (value.includes('kryteria')) return 'CRITERIA';
  if (value.includes('wniosek') || value.includes('formularz')) return 'OFFICIAL_FORM';
  return 'OFFICIAL_ATTACHMENT';
}

const attachmentImportSchema = z.object({
  parentSourceId: z.string().min(1),
  attachments: z.array(z.object({
    name: z.string().min(1).max(500),
    url: z.string().url()
  })).min(1).max(100)
});

app.post('/v1/internal/source-attachments/import', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = attachmentImportSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_ATTACHMENTS', details: parsed.error.flatten() });
  }

  const parent = await prisma.source.findUnique({
    where: { id: parsed.data.parentSourceId }
  });
  if (!parent) return reply.code(404).send({ error: 'PARENT_SOURCE_NOT_FOUND' });

  const imported = [];
  for (const attachment of parsed.data.attachments) {
    const kind = classifyOfficialAttachment(attachment.name, attachment.url);
    const child = await prisma.source.upsert({
      where: { canonicalUrl: attachment.url },
      update: {
        institutionId: parent.institutionId,
        displayName: attachment.name,
        discoveredFromUrl: parent.canonicalUrl,
        kind,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: parent.scopeVoivodeship,
        scopeCounty: parent.scopeCounty,
        scopeMunicipality: parent.scopeMunicipality
      },
      create: {
        institutionId: parent.institutionId,
        canonicalUrl: attachment.url,
        displayName: attachment.name,
        discoveredFromUrl: parent.canonicalUrl,
        kind,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: parent.scopeVoivodeship,
        scopeCounty: parent.scopeCounty,
        scopeMunicipality: parent.scopeMunicipality
      }
    });
    imported.push({ id: child.id, name: child.displayName, kind: child.kind, url: child.canonicalUrl });
  }

  return { imported };
});

const sourceDocumentSchema = z.object({
  sourceId: z.string().min(1),
  originalName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: z.string().min(1).max(1500),
  downloadedAt: z.string().datetime()
});

app.post('/v1/internal/source-document', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = sourceDocumentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_SOURCE_DOCUMENT', details: parsed.error.flatten() });
  }

  const source = await prisma.source.findUnique({ where: { id: parsed.data.sourceId } });
  if (!source) return reply.code(404).send({ error: 'SOURCE_NOT_FOUND' });

  let discoveredFundingCallId: string | null = null;
  if (source.discoveredFromUrl) {
    const parentSource = await prisma.source.findUnique({
      where: { canonicalUrl: source.discoveredFromUrl },
      select: { id: true }
    });

    if (parentSource) {
      const call = await prisma.fundingCall.findUnique({
        where: { sourceId: parentSource.id },
        select: { id: true }
      });
      discoveredFundingCallId = call?.id ?? null;
    }
  }

  const existing = await prisma.sourceDocument.findUnique({
    where: {
      sourceId_sha256: {
        sourceId: source.id,
        sha256: parsed.data.sha256
      }
    },
    include: { formTemplates: true }
  });

  if (existing) {
    return {
      documentId: existing.id,
      created: false,
      templateId: existing.formTemplates[0]?.id ?? null
    };
  }

  const document = await prisma.sourceDocument.create({
    data: {
      sourceId: source.id,
      originalName: parsed.data.originalName,
      mimeType: parsed.data.mimeType,
      sha256: parsed.data.sha256,
      storageKey: parsed.data.storageKey,
      downloadedAt: new Date(parsed.data.downloadedAt)
    }
  });

  let templateId: string | null = null;
  if (source.kind === 'OFFICIAL_FORM') {
    await prisma.officialFormTemplate.updateMany({
      where: {
        active: true,
        sourceDocument: { sourceId: source.id }
      },
      data: { active: false }
    });

    const template = await prisma.officialFormTemplate.create({
      data: {
        sourceDocumentId: document.id,
        institutionId: source.institutionId,
        formCode: `source:${source.id}`,
        versionLabel: parsed.data.sha256.slice(0, 12),
        fundingCallId: discoveredFundingCallId,
        active: true,
        officialOnly: true
      }
    });
    templateId = template.id;
  }

  return {
    documentId: document.id,
    created: true,
    templateId
  };
});




const templateMappingsSchema = z.object({
  mappingStatus: z.enum(['DRAFT', 'VERIFIED']),
  requiredForPackage: z.boolean().optional(),
  analysis: z.unknown().optional(),
  mappings: z.array(z.object({
    fieldKey: z.string().min(1).max(240),
    sourcePath: z.string().max(1000).default(''),
    locatorType: z.enum([
      'PDF_ACROFORM',
      'PDF_COORDINATE',
      'DOCX_TOKEN',
      'DOCX_TABLE_CELL',
      'DOCX_PARAGRAPH',
      'XLSX_CELL'
    ]),
    locatorJson: z.record(z.string(), z.unknown()).optional(),
    inputType: z.string().min(1).max(80),
    questionLabel: z.string().min(1).max(500).optional(),
    section: z.string().max(300).optional(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    required: z.boolean().default(false),
    helpText: z.string().max(2000).optional(),
    validationJson: z.record(z.string(), z.unknown()).optional()
  })).max(500)
});

app.put('/v1/internal/templates/:id/mappings', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = templateMappingsSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_TEMPLATE_MAPPINGS', details: parsed.error.flatten() });
  }

  const template = await prisma.officialFormTemplate.findUnique({
    where: { id },
    include: { sourceDocument: true }
  });
  if (!template) return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });
  if (!template.officialOnly) {
    return reply.code(409).send({ error: 'OFFICIAL_TEMPLATE_REQUIRED' });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.formFieldMapping.deleteMany({ where: { templateId: id } });

    if (parsed.data.mappings.length > 0) {
      await tx.formFieldMapping.createMany({
        data: parsed.data.mappings.map((mapping) => ({
          templateId: id,
          fieldKey: mapping.fieldKey,
          sourcePath: mapping.sourcePath,
          locatorType: mapping.locatorType,
          locatorJson: mapping.locatorJson as never,
          inputType: mapping.inputType,
          questionLabel: mapping.questionLabel ?? null,
          section: mapping.section ?? null,
          sortOrder: mapping.sortOrder,
          required: mapping.required,
          helpText: mapping.helpText ?? null,
          validationJson: mapping.validationJson as never
        }))
      });
    }

    return tx.officialFormTemplate.update({
      where: { id },
      data: {
        mappingStatus: parsed.data.mappingStatus,
        requiredForPackage: parsed.data.requiredForPackage ?? true,
        mappingVerifiedAt: parsed.data.mappingStatus === 'VERIFIED' ? new Date() : null,
        mappingAnalyzedAt: parsed.data.mappingStatus === 'DRAFT' ? new Date() : undefined,
        mappingAnalysisJson: parsed.data.analysis === undefined ? undefined : parsed.data.analysis as never,
        mappingAnalysisError: null,
        mappingVersion: { increment: 1 }
      },
      include: {
        fieldMappings: { orderBy: { sortOrder: 'asc' } }
      }
    });
  });

  await prisma.auditEvent.create({
    data: {
      actorType: 'SYSTEM',
      action: parsed.data.mappingStatus === 'VERIFIED'
        ? 'OFFICIAL_FORM_MAPPING_VERIFIED'
        : 'OFFICIAL_FORM_MAPPING_UPDATED',
      entity: 'OfficialFormTemplate',
      entityId: id,
      metadata: {
        sourceSha256: template.sourceDocument.sha256,
        mappingVersion: result.mappingVersion,
        fields: result.fieldMappings.length
      }
    }
  });

  return {
    templateId: result.id,
    mappingStatus: result.mappingStatus,
    mappingVersion: result.mappingVersion,
    fields: result.fieldMappings.length
  };
});


app.post('/v1/internal/templates/claim-analysis', async (request) => {
  requireWorkerSecret(request);

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await prisma.officialFormTemplate.findFirst({
      where: {
        active: true,
        officialOnly: true,
        mappingStatus: 'UNMAPPED'
      },
      orderBy: { id: 'asc' },
      select: { id: true }
    });

    if (!candidate) return { template: null };

    const claimed = await prisma.officialFormTemplate.updateMany({
      where: {
        id: candidate.id,
        mappingStatus: 'UNMAPPED'
      },
      data: {
        mappingStatus: 'ANALYZING',
        mappingAnalysisError: null
      }
    });

    if (claimed.count === 1) {
      return { template: { id: candidate.id } };
    }
  }

  return { template: null };
});

app.get('/v1/internal/templates/:id/analysis-payload', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;

  const template = await prisma.officialFormTemplate.findUnique({
    where: { id },
    include: {
      sourceDocument: {
        include: {
          source: {
            select: {
              canonicalUrl: true,
              displayName: true
            }
          }
        }
      }
    }
  });

  if (!template) return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });
  if (template.mappingStatus !== 'ANALYZING') {
    return reply.code(409).send({ error: 'TEMPLATE_NOT_ANALYZING' });
  }

  return {
    template: {
      id: template.id,
      mappingVersion: template.mappingVersion
    },
    source: {
      documentId: template.sourceDocument.id,
      originalName: template.sourceDocument.originalName,
      mimeType: template.sourceDocument.mimeType,
      sha256: template.sourceDocument.sha256,
      storageKey: template.sourceDocument.storageKey,
      officialUrl: template.sourceDocument.source.canonicalUrl
    }
  };
});

const analysisFailureSchema = z.object({
  error: z.string().min(1).max(4000)
});

app.post('/v1/internal/templates/:id/analysis-failed', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = analysisFailureSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_ANALYSIS_FAILURE' });
  }

  const result = await prisma.officialFormTemplate.updateMany({
    where: { id, mappingStatus: 'ANALYZING' },
    data: {
      mappingStatus: 'ANALYSIS_FAILED',
      mappingAnalysisError: parsed.data.error,
      mappingAnalyzedAt: new Date()
    }
  });

  if (result.count !== 1) {
    return reply.code(409).send({ error: 'TEMPLATE_NOT_ANALYZING' });
  }

  return { templateId: id, status: 'ANALYSIS_FAILED' };
});

app.post('/v1/internal/templates/:id/reset-analysis', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;

  const result = await prisma.officialFormTemplate.updateMany({
    where: {
      id,
      mappingStatus: { in: ['ANALYSIS_FAILED', 'DRAFT'] }
    },
    data: {
      mappingStatus: 'UNMAPPED',
      mappingAnalysisError: null
    }
  });

  if (result.count !== 1) {
    return reply.code(409).send({ error: 'TEMPLATE_CANNOT_BE_RESET' });
  }

  return { templateId: id, status: 'UNMAPPED' };
});


app.post('/v1/internal/package-jobs/claim', async (request) => {
  requireWorkerSecret(request);

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await prisma.documentPackageJob.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { requestedAt: 'asc' },
      select: { id: true }
    });

    if (!candidate) return { job: null };

    const claimed = await prisma.documentPackageJob.updateMany({
      where: { id: candidate.id, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() }
    });

    if (claimed.count === 1) {
      return { job: { id: candidate.id } };
    }
  }

  return { job: null };
});

app.get('/v1/internal/package-jobs/:id/payload', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;

  const job = await prisma.documentPackageJob.findUnique({
    where: { id },
    include: {
      submissionInstruction: true,
      case: {
        include: {
          user: {
            select: {
              email: true,
              emailVerifiedAt: true,
              telegramFirstName: true,
              telegramLastName: true
            }
          },
          fundingCall: {
            include: {
              institution: {
                select: {
                  name: true,
                  officialUrl: true
                }
              }
            }
          },
          renderJobs: {
            where: {
              status: 'COMPLETED',
              outputStorageKey: { not: null }
            },
            include: {
              template: {
                include: {
                  sourceDocument: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!job) return reply.code(404).send({ error: 'PACKAGE_JOB_NOT_FOUND' });
  if (job.status !== 'PROCESSING') {
    return reply.code(409).send({ error: 'PACKAGE_JOB_NOT_PROCESSING' });
  }
  if (!job.case.user.email || !job.case.user.emailVerifiedAt) {
    return reply.code(409).send({ error: 'VERIFIED_EMAIL_REQUIRED' });
  }
  if (!job.case.fundingCall) {
    return reply.code(409).send({ error: 'FUNDING_CALL_SELECTION_REQUIRED' });
  }
  if (
    job.submissionInstruction.status !== 'VERIFIED' ||
    !job.submissionInstruction.verifiedAt
  ) {
    return reply.code(409).send({ error: 'VERIFIED_SUBMISSION_INSTRUCTION_REQUIRED' });
  }

  const requiredDocuments = job.case.renderJobs
    .filter((render) => render.template.requiredForPackage)
    .map((render) => ({
      renderJobId: render.id,
      storageKey: render.outputStorageKey!,
      outputName: render.outputName ?? render.template.sourceDocument.originalName,
      mimeType: render.outputMimeType ?? render.template.sourceDocument.mimeType,
      sourceSha256: render.template.sourceDocument.sha256,
      formCode: render.template.formCode
    }));

  return {
    job: {
      id: job.id,
      caseId: job.caseId,
      recipientEmail: job.recipientEmail
    },
    applicant: {
      firstName: job.case.user.telegramFirstName,
      lastName: job.case.user.telegramLastName
    },
    fundingCall: {
      id: job.case.fundingCall.id,
      title: job.case.fundingCall.title,
      officialUrl: job.case.fundingCall.officialUrl,
      institutionName: job.case.fundingCall.institution.name,
      institutionUrl: job.case.fundingCall.institution.officialUrl,
      opensAt: job.case.fundingCall.opensAt,
      closesAt: job.case.fundingCall.closesAt
    },
    submissionInstruction: {
      id: job.submissionInstruction.id,
      version: job.submissionInstruction.version,
      instruction: job.submissionInstruction.instructionJson,
      sourceUrl: job.submissionInstruction.sourceUrl,
      sourceHash: job.submissionInstruction.sourceHash,
      verifiedAt: job.submissionInstruction.verifiedAt
    },
    documents: requiredDocuments
  };
});

const packageJobResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    outputStorageKey: z.string().min(1).max(1500),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputName: z.string().min(1).max(500)
  }),
  z.object({
    success: z.literal(false),
    errorCode: z.string().min(1).max(120),
    errorMessage: z.string().min(1).max(4000)
  })
]);

app.post('/v1/internal/package-jobs/:id/result', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = packageJobResultSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_PACKAGE_JOB_RESULT' });
  }

  const job = await prisma.documentPackageJob.findUnique({
    where: { id },
    include: {
      case: { select: { userId: true } }
    }
  });

  if (!job) return reply.code(404).send({ error: 'PACKAGE_JOB_NOT_FOUND' });
  if (!['QUEUED', 'PROCESSING'].includes(job.status)) {
    return reply.code(409).send({ error: 'PACKAGE_JOB_ALREADY_FINALIZED' });
  }

  const resultData = parsed.data;

  if (resultData.success === false) {
    const failed = await prisma.documentPackageJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: resultData.errorCode,
        errorMessage: resultData.errorMessage,
        completedAt: new Date()
      }
    });

    return { job: failed };
  }

  const completed = await prisma.documentPackageJob.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      outputStorageKey: resultData.outputStorageKey,
      outputSha256: resultData.outputSha256,
      outputName: resultData.outputName,
      errorCode: null,
      errorMessage: null,
      completedAt: new Date()
    }
  });

  await prisma.auditEvent.create({
    data: {
      userId: job.case.userId,
      actorType: 'SYSTEM',
      action: 'DOCUMENT_PACKAGE_DELIVERED',
      entity: 'DocumentPackageJob',
      entityId: id,
      metadata: {
        caseId: job.caseId,
        outputSha256: resultData.outputSha256,
        outputName: resultData.outputName
      }
    }
  });

  return { job: completed };
});

app.post('/v1/internal/document-jobs/claim', async (request) => {
  requireWorkerSecret(request);

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await prisma.documentRenderJob.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { requestedAt: 'asc' },
      select: { id: true }
    });

    if (!candidate) return { job: null };

    const claimed = await prisma.documentRenderJob.updateMany({
      where: { id: candidate.id, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() }
    });

    if (claimed.count === 1) {
      return { job: { id: candidate.id } };
    }
  }

  return { job: null };
});

app.get('/v1/internal/document-jobs/:id/payload', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;

  const job = await prisma.documentRenderJob.findUnique({
    where: { id },
    include: {
      case: { select: { id: true, userId: true } },
      template: {
        include: {
          sourceDocument: true,
          fieldMappings: { orderBy: { sortOrder: 'asc' } }
        }
      }
    }
  });

  if (!job) return reply.code(404).send({ error: 'DOCUMENT_JOB_NOT_FOUND' });
  if (job.status !== 'PROCESSING') {
    return reply.code(409).send({ error: 'DOCUMENT_JOB_NOT_PROCESSING' });
  }
  if (
    !job.template.active ||
    !job.template.officialOnly ||
    job.template.mappingStatus !== 'VERIFIED'
  ) {
    return reply.code(409).send({ error: 'TEMPLATE_NOT_RENDERABLE' });
  }

  const values = await buildResolvedCaseValues(job.caseId, job.case.userId);

  return {
    job: {
      id: job.id,
      caseId: job.caseId,
      templateId: job.templateId
    },
    source: {
      documentId: job.template.sourceDocument.id,
      originalName: job.template.sourceDocument.originalName,
      mimeType: job.template.sourceDocument.mimeType,
      sha256: job.template.sourceDocument.sha256,
      storageKey: job.template.sourceDocument.storageKey
    },
    template: {
      versionLabel: job.template.versionLabel,
      mappingVersion: job.template.mappingVersion,
      mappings: job.template.fieldMappings.map((mapping) => ({
        fieldKey: mapping.fieldKey,
        sourcePath: mapping.sourcePath,
        locatorType: mapping.locatorType,
        locatorJson: mapping.locatorJson,
        inputType: mapping.inputType,
        required: mapping.required
      }))
    },
    values
  };
});

const documentJobResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    outputStorageKey: z.string().min(1).max(1500),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputMimeType: z.string().min(1).max(200),
    outputName: z.string().min(1).max(500)
  }),
  z.object({
    success: z.literal(false),
    errorCode: z.string().min(1).max(120),
    errorMessage: z.string().min(1).max(4000)
  })
]);

app.post('/v1/internal/document-jobs/:id/result', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = documentJobResultSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_DOCUMENT_JOB_RESULT' });
  }

  const job = await prisma.documentRenderJob.findUnique({
    where: { id },
    include: {
      template: { include: { sourceDocument: true } },
      case: { select: { userId: true } }
    }
  });
  if (!job) return reply.code(404).send({ error: 'DOCUMENT_JOB_NOT_FOUND' });
  if (!['PROCESSING', 'QUEUED'].includes(job.status)) {
    return reply.code(409).send({ error: 'DOCUMENT_JOB_ALREADY_FINALIZED' });
  }

  const resultData = parsed.data;

  if (resultData.success === false) {
    const failed = await prisma.documentRenderJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: resultData.errorCode,
        errorMessage: resultData.errorMessage,
        completedAt: new Date()
      }
    });
    return { job: failed };
  }

  const successData = resultData;

  const result = await prisma.$transaction(async (tx) => {
    const completed = await tx.documentRenderJob.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        outputStorageKey: successData.outputStorageKey,
        outputSha256: successData.outputSha256,
        outputMimeType: successData.outputMimeType,
        outputName: successData.outputName,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });

    const document = await tx.caseDocument.upsert({
      where: { renderJobId: id },
      update: {
        storageKey: successData.outputStorageKey,
        originalName: successData.outputName,
        mimeType: successData.outputMimeType,
        templateHash: job.template.sourceDocument.sha256,
        sourceDocumentId: job.template.sourceDocument.id
      },
      create: {
        caseId: job.caseId,
        type: 'FILLED_OFFICIAL_FORM',
        originalName: successData.outputName,
        mimeType: successData.outputMimeType,
        storageKey: successData.outputStorageKey,
        officialSource: false,
        templateHash: job.template.sourceDocument.sha256,
        sourceDocumentId: job.template.sourceDocument.id,
        renderJobId: id
      }
    });

    return { completed, document };
  });

  await prisma.auditEvent.create({
    data: {
      userId: job.case.userId,
      actorType: 'SYSTEM',
      action: 'OFFICIAL_FORM_RENDER_COMPLETED',
      entity: 'CaseDocument',
      entityId: result.document.id,
      metadata: {
        renderJobId: id,
        sourceDocumentId: job.template.sourceDocument.id,
        templateHash: job.template.sourceDocument.sha256,
        outputSha256: successData.outputSha256
      }
    }
  });

  return {
    job: result.completed,
    document: result.document
  };
});


const terytImportSchema = z.object({
  sourceVersion: z.string().max(120).optional(),
  municipalities: z.array(z.object({
    tercCode: z.string().min(4).max(7),
    voivodeshipCode: z.string().length(2),
    voivodeship: z.string().min(2).max(120),
    countyCode: z.string().max(2).optional(),
    county: z.string().max(120).optional(),
    municipalityCode: z.string().max(2).optional(),
    municipality: z.string().min(1).max(120),
    municipalityTypeCode: z.string().max(2).optional(),
    municipalityType: z.string().max(120).optional(),
    validFrom: z.string().date().optional(),
    validTo: z.string().date().optional()
  })).max(5000),
  localities: z.array(z.object({
    simcCode: z.string().min(1).max(12),
    name: z.string().min(1).max(160),
    localityType: z.string().max(120).optional(),
    municipalityTercCode: z.string().min(4).max(7)
  })).max(10000)
});

app.post('/v1/internal/teryt/import', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = terytImportSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_TERYT_IMPORT',
      details: parsed.error.flatten()
    });
  }

  const now = new Date();
  let municipalitiesUpserted = 0;
  let localitiesUpserted = 0;

  for (const item of parsed.data.municipalities) {
    await prisma.terytMunicipality.upsert({
      where: { tercCode: item.tercCode },
      update: {
        voivodeshipCode: item.voivodeshipCode,
        voivodeship: item.voivodeship,
        countyCode: item.countyCode ?? null,
        county: item.county ?? null,
        municipalityCode: item.municipalityCode ?? null,
        municipality: item.municipality,
        municipalityTypeCode: item.municipalityTypeCode ?? null,
        municipalityType: item.municipalityType ?? null,
        validFrom: item.validFrom ? new Date(item.validFrom) : null,
        validTo: item.validTo ? new Date(item.validTo) : null,
        sourceUpdatedAt: now,
        sourceVersion: parsed.data.sourceVersion ?? null
      },
      create: {
        tercCode: item.tercCode,
        voivodeshipCode: item.voivodeshipCode,
        voivodeship: item.voivodeship,
        countyCode: item.countyCode ?? null,
        county: item.county ?? null,
        municipalityCode: item.municipalityCode ?? null,
        municipality: item.municipality,
        municipalityTypeCode: item.municipalityTypeCode ?? null,
        municipalityType: item.municipalityType ?? null,
        validFrom: item.validFrom ? new Date(item.validFrom) : null,
        validTo: item.validTo ? new Date(item.validTo) : null,
        sourceUpdatedAt: now,
        sourceVersion: parsed.data.sourceVersion ?? null
      }
    });
    municipalitiesUpserted++;
  }

  for (const item of parsed.data.localities) {
    const municipalityExists = await prisma.terytMunicipality.findUnique({
      where: { tercCode: item.municipalityTercCode },
      select: { tercCode: true }
    });
    if (!municipalityExists) continue;

    await prisma.terytLocality.upsert({
      where: { simcCode: item.simcCode },
      update: {
        name: item.name,
        localityType: item.localityType ?? null,
        municipalityTercCode: item.municipalityTercCode,
        sourceUpdatedAt: now,
        sourceVersion: parsed.data.sourceVersion ?? null
      },
      create: {
        simcCode: item.simcCode,
        name: item.name,
        localityType: item.localityType ?? null,
        municipalityTercCode: item.municipalityTercCode,
        sourceUpdatedAt: now,
        sourceVersion: parsed.data.sourceVersion ?? null
      }
    });
    localitiesUpserted++;
  }

  return {
    municipalitiesUpserted,
    localitiesUpserted,
    sourceVersion: parsed.data.sourceVersion ?? null
  };
});



const callPageImportSchema = z.object({
  parentSourceId: z.string().min(1),
  pages: z.array(z.object({
    name: z.string().min(1).max(500),
    url: z.string().url()
  })).min(1).max(100)
});

app.post('/v1/internal/call-pages/import', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = callPageImportSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_CALL_PAGES',
      details: parsed.error.flatten()
    });
  }

  const parent = await prisma.source.findUnique({
    where: { id: parsed.data.parentSourceId }
  });

  if (!parent || !parent.institutionId) {
    return reply.code(404).send({ error: 'PARENT_SOURCE_NOT_FOUND' });
  }

  const imported = [];
  for (const page of parsed.data.pages) {
    const child = await prisma.source.upsert({
      where: { canonicalUrl: page.url },
      update: {
        institutionId: parent.institutionId,
        kind: 'PUP_CALL_PAGE',
        displayName: page.name,
        discoveredFromUrl: parent.canonicalUrl,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: parent.scopeVoivodeship,
        scopeCounty: parent.scopeCounty,
        scopeMunicipality: parent.scopeMunicipality
      },
      create: {
        institutionId: parent.institutionId,
        kind: 'PUP_CALL_PAGE',
        canonicalUrl: page.url,
        displayName: page.name,
        discoveredFromUrl: parent.canonicalUrl,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: parent.scopeVoivodeship,
        scopeCounty: parent.scopeCounty,
        scopeMunicipality: parent.scopeMunicipality
      }
    });

    imported.push({
      id: child.id,
      name: child.displayName,
      url: child.canonicalUrl
    });
  }

  return { imported };
});

const fundingCallDraftSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(3).max(700),
  officialUrl: z.string().url(),
  programCode: z.string().max(120).optional(),
  candidateStatus: z.enum(['DISCOVERED', 'ANNOUNCED', 'OPEN', 'CLOSED', 'SUSPENDED']).optional(),
  opensAt: z.string().datetime().optional(),
  closesAt: z.string().datetime().optional(),
  untilExhausted: z.boolean().optional(),
  evidence: z.unknown().optional()
});

app.post('/v1/internal/funding-calls/upsert-draft', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = fundingCallDraftSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_FUNDING_CALL_DRAFT',
      details: parsed.error.flatten()
    });
  }

  const source = await prisma.source.findUnique({
    where: { id: parsed.data.sourceId }
  });

  if (!source?.institutionId) {
    return reply.code(404).send({ error: 'CALL_SOURCE_NOT_FOUND' });
  }

  const now = new Date();
  const evidence = {
    candidateStatus: parsed.data.candidateStatus ?? 'DISCOVERED',
    candidateOpensAt: parsed.data.opensAt ?? null,
    candidateClosesAt: parsed.data.closesAt ?? null,
    candidateUntilExhausted: parsed.data.untilExhausted ?? false,
    parserEvidence: parsed.data.evidence ?? null
  };

  const call = await prisma.fundingCall.upsert({
    where: { sourceId: source.id },
    update: {
      institutionId: source.institutionId,
      title: parsed.data.title,
      programCode: parsed.data.programCode ?? null,
      officialUrl: parsed.data.officialUrl,
      verificationStatus: 'DRAFT',
      evidenceJson: evidence as never,
      sourceHash: source.contentHash,
      lastSeenAt: now
    },
    create: {
      institutionId: source.institutionId,
      sourceId: source.id,
      title: parsed.data.title,
      programCode: parsed.data.programCode ?? null,
      status: 'DISCOVERED',
      officialUrl: parsed.data.officialUrl,
      verificationStatus: 'DRAFT',
      evidenceJson: evidence as never,
      sourceHash: source.contentHash,
      discoveredAt: now,
      lastSeenAt: now
    }
  });

  return { call };
});

const verifyFundingCallSchema = z.object({
  status: z.enum(['ANNOUNCED', 'OPEN', 'CLOSED', 'SUSPENDED']),
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  untilExhausted: z.boolean().default(false),
  programCode: z.string().max(120).nullable().optional()
});

app.post('/v1/internal/funding-calls/:id/verify', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = verifyFundingCallSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_FUNDING_CALL_VERIFICATION',
      details: parsed.error.flatten()
    });
  }

  const existing = await prisma.fundingCall.findUnique({
    where: { id },
    include: { source: true }
  });

  if (!existing) {
    return reply.code(404).send({ error: 'FUNDING_CALL_NOT_FOUND' });
  }

  const now = new Date();
  const updated = await prisma.fundingCall.update({
    where: { id },
    data: {
      status: parsed.data.status,
      opensAt: parsed.data.opensAt === undefined
        ? existing.opensAt
        : parsed.data.opensAt
          ? new Date(parsed.data.opensAt)
          : null,
      closesAt: parsed.data.closesAt === undefined
        ? existing.closesAt
        : parsed.data.closesAt
          ? new Date(parsed.data.closesAt)
          : null,
      untilExhausted: parsed.data.untilExhausted,
      programCode: parsed.data.programCode === undefined
        ? existing.programCode
        : parsed.data.programCode,
      verificationStatus: 'VERIFIED',
      verifiedAt: now,
      lastSeenAt: now
    }
  });

  const source = existing.source;
  await prisma.changeEvent.create({
    data: {
      sourceId: source?.id ?? null,
      changeType: 'FUNDING_CALL_VERIFIED',
      severity: parsed.data.status === 'OPEN' ? 'YELLOW' : 'INFORMATION',
      summary: `Zweryfikowano nabór: ${updated.title} (${updated.status})`,
      verified: true,
      verifiedAt: now,
      verificationScore: 100,
      payload: {
        fundingCallId: updated.id,
        status: updated.status,
        opensAt: updated.opensAt,
        closesAt: updated.closesAt,
        scopeVoivodeship: source?.scopeVoivodeship ?? null,
        scopeCounty: source?.scopeCounty ?? null,
        scopeMunicipality: source?.scopeMunicipality ?? null
      }
    }
  });

  return { call: updated };
});


app.post('/v1/internal/funding-calls/advance-statuses', async (request) => {
  requireWorkerSecret(request);
  const now = new Date();

  const candidates = await prisma.fundingCall.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      verifiedAt: { not: null },
      OR: [
        {
          status: 'ANNOUNCED',
          opensAt: { lte: now }
        },
        {
          status: { in: ['ANNOUNCED', 'OPEN'] },
          closesAt: { lt: now }
        }
      ]
    },
    include: { source: true },
    orderBy: [{ opensAt: 'asc' }, { closesAt: 'asc' }],
    take: 500
  });

  let opened = 0;
  let closed = 0;

  for (const call of candidates) {
    let nextStatus: 'OPEN' | 'CLOSED' | null = null;

    if (call.closesAt && call.closesAt < now) {
      nextStatus = 'CLOSED';
    } else if (
      call.status === 'ANNOUNCED' &&
      call.opensAt &&
      call.opensAt <= now
    ) {
      nextStatus = 'OPEN';
    }

    if (!nextStatus || nextStatus === call.status) continue;

    const updated = await prisma.fundingCall.update({
      where: { id: call.id },
      data: {
        status: nextStatus,
        lastSeenAt: now
      }
    });

    if (nextStatus === 'OPEN') opened++;
    if (nextStatus === 'CLOSED') closed++;

    await prisma.changeEvent.create({
      data: {
        sourceId: call.sourceId,
        changeType: 'FUNDING_CALL_STATUS_TRANSITION',
        severity: nextStatus === 'OPEN' ? 'YELLOW' : 'INFORMATION',
        summary: `Nabór ${updated.title}: status ${call.status} → ${nextStatus}`,
        verified: true,
        verifiedAt: now,
        verificationScore: 100,
        payload: {
          fundingCallId: updated.id,
          previousStatus: call.status,
          status: nextStatus,
          opensAt: updated.opensAt,
          closesAt: updated.closesAt,
          scopeVoivodeship: call.source?.scopeVoivodeship ?? null,
          scopeCounty: call.source?.scopeCounty ?? null,
          scopeMunicipality: call.source?.scopeMunicipality ?? null
        }
      }
    });
  }

  return {
    checked: candidates.length,
    opened,
    closed
  };
});


const localCriterionSchema = z.object({
  code: z.string().min(1).max(120),
  category: z.string().max(300).optional(),
  title: z.string().min(1).max(700),
  description: z.string().max(5000).optional(),
  maxPoints: z.number().min(0).max(1000).optional(),
  failIfZero: z.boolean().default(false),
  scoringJson: z.unknown().optional(),
  evidenceHint: z.string().max(3000).optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0)
});

const criterionSetDraftSchema = z.object({
  sourceDocumentId: z.string().min(1),
  title: z.string().min(3).max(700),
  minimumPoints: z.number().min(0).max(1000).optional(),
  maximumPoints: z.number().min(0).max(1000).optional(),
  blockingRulesJson: z.unknown().optional(),
  analysisJson: z.unknown().optional(),
  criteria: z.array(localCriterionSchema).max(300)
});

app.post('/v1/internal/criterion-sets/upsert-draft', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = criterionSetDraftSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_CRITERION_SET_DRAFT',
      details: parsed.error.flatten()
    });
  }

  const document = await prisma.sourceDocument.findUnique({
    where: { id: parsed.data.sourceDocumentId },
    include: { source: true }
  });

  if (!document || !document.source.institutionId) {
    return reply.code(404).send({ error: 'CRITERIA_SOURCE_DOCUMENT_NOT_FOUND' });
  }

  if (document.source.kind !== 'CRITERIA') {
    return reply.code(409).send({ error: 'CRITERIA_DOCUMENT_REQUIRED' });
  }

  const existing = await prisma.localCriterionSet.findUnique({
    where: { sourceDocumentId: document.id },
    include: { criteria: true }
  });

  if (existing?.status === 'VERIFIED') {
    return {
      criterionSet: existing,
      protected: true,
      reason: 'VERIFIED_SET_CANNOT_BE_OVERWRITTEN_BY_AUTOMATION'
    };
  }

  let fundingCallId: string | null = null;
  if (document.source.discoveredFromUrl) {
    const callSource = await prisma.source.findUnique({
      where: { canonicalUrl: document.source.discoveredFromUrl },
      select: { id: true }
    });

    if (callSource) {
      const call = await prisma.fundingCall.findUnique({
        where: { sourceId: callSource.id },
        select: { id: true }
      });
      fundingCallId = call?.id ?? null;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const set = await tx.localCriterionSet.upsert({
      where: { sourceDocumentId: document.id },
      update: {
        institutionId: document.source.institutionId!,
        fundingCallId,
        title: parsed.data.title,
        status: 'DRAFT',
        minimumPoints: parsed.data.minimumPoints ?? null,
        maximumPoints: parsed.data.maximumPoints ?? null,
        blockingRulesJson: parsed.data.blockingRulesJson as never,
        analysisJson: parsed.data.analysisJson as never,
        sourceHash: document.sha256,
        analyzedAt: new Date(),
        verifiedAt: null,
        version: { increment: 1 }
      },
      create: {
        institutionId: document.source.institutionId!,
        fundingCallId,
        sourceDocumentId: document.id,
        title: parsed.data.title,
        status: 'DRAFT',
        minimumPoints: parsed.data.minimumPoints ?? null,
        maximumPoints: parsed.data.maximumPoints ?? null,
        blockingRulesJson: parsed.data.blockingRulesJson as never,
        analysisJson: parsed.data.analysisJson as never,
        sourceHash: document.sha256,
        analyzedAt: new Date()
      }
    });

    await tx.localCriterion.deleteMany({
      where: { criterionSetId: set.id }
    });

    if (parsed.data.criteria.length > 0) {
      await tx.localCriterion.createMany({
        data: parsed.data.criteria.map((criterion) => ({
          criterionSetId: set.id,
          code: criterion.code,
          category: criterion.category ?? null,
          title: criterion.title,
          description: criterion.description ?? null,
          maxPoints: criterion.maxPoints ?? null,
          failIfZero: criterion.failIfZero,
          scoringJson: criterion.scoringJson as never,
          evidenceHint: criterion.evidenceHint ?? null,
          sortOrder: criterion.sortOrder
        }))
      });
    }

    return tx.localCriterionSet.findUniqueOrThrow({
      where: { id: set.id },
      include: {
        criteria: { orderBy: { sortOrder: 'asc' } },
        sourceDocument: true
      }
    });
  });

  return {
    criterionSet: result,
    protected: false
  };
});

const verifyCriterionSetSchema = z.object({
  title: z.string().min(3).max(700).optional(),
  minimumPoints: z.number().min(0).max(1000).nullable().optional(),
  maximumPoints: z.number().min(0).max(1000).nullable().optional(),
  blockingRulesJson: z.unknown().optional(),
  criteria: z.array(localCriterionSchema).max(300).optional()
});

app.post('/v1/internal/criterion-sets/:id/verify', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = verifyCriterionSetSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_CRITERION_SET_VERIFICATION',
      details: parsed.error.flatten()
    });
  }

  const existing = await prisma.localCriterionSet.findUnique({
    where: { id },
    include: {
      criteria: true,
      sourceDocument: { include: { source: true } }
    }
  });

  if (!existing) {
    return reply.code(404).send({ error: 'CRITERION_SET_NOT_FOUND' });
  }

  if (existing.sourceHash !== existing.sourceDocument.sha256) {
    return reply.code(409).send({ error: 'CRITERIA_SOURCE_HASH_MISMATCH' });
  }

  const result = await prisma.$transaction(async (tx) => {
    if (parsed.data.criteria) {
      await tx.localCriterion.deleteMany({
        where: { criterionSetId: id }
      });

      if (parsed.data.criteria.length > 0) {
        await tx.localCriterion.createMany({
          data: parsed.data.criteria.map((criterion) => ({
            criterionSetId: id,
            code: criterion.code,
            category: criterion.category ?? null,
            title: criterion.title,
            description: criterion.description ?? null,
            maxPoints: criterion.maxPoints ?? null,
            failIfZero: criterion.failIfZero,
            scoringJson: criterion.scoringJson as never,
            evidenceHint: criterion.evidenceHint ?? null,
            sortOrder: criterion.sortOrder
          }))
        });
      }
    }

    return tx.localCriterionSet.update({
      where: { id },
      data: {
        title: parsed.data.title ?? existing.title,
        minimumPoints: parsed.data.minimumPoints === undefined
          ? existing.minimumPoints
          : parsed.data.minimumPoints,
        maximumPoints: parsed.data.maximumPoints === undefined
          ? existing.maximumPoints
          : parsed.data.maximumPoints,
        ...(parsed.data.blockingRulesJson !== undefined
          ? { blockingRulesJson: parsed.data.blockingRulesJson as never }
          : {}),
        status: 'VERIFIED',
        verifiedAt: new Date(),
        version: { increment: 1 }
      },
      include: {
        criteria: { orderBy: { sortOrder: 'asc' } },
        sourceDocument: true
      }
    });
  });

  const source = existing.sourceDocument.source;
  await prisma.changeEvent.create({
    data: {
      sourceId: source.id,
      changeType: 'LOCAL_CRITERIA_VERIFIED',
      severity: 'YELLOW',
      summary: `Zweryfikowano lokalne kryteria: ${result.title}`,
      verified: true,
      verifiedAt: new Date(),
      verificationScore: 100,
      payload: {
        criterionSetId: result.id,
        fundingCallId: result.fundingCallId,
        sourceDocumentId: result.sourceDocumentId,
        sourceHash: result.sourceHash,
        minimumPoints: result.minimumPoints,
        maximumPoints: result.maximumPoints,
        scopeVoivodeship: source.scopeVoivodeship,
        scopeCounty: source.scopeCounty,
        scopeMunicipality: source.scopeMunicipality
      }
    }
  });

  return { criterionSet: result };
});


const submissionInstructionSchema = z.object({
  institutionName: z.string().min(2).max(500),
  methods: z.array(z.enum(['IN_PERSON', 'POSTAL', 'ELECTRONIC'])).min(1).max(3),
  address: z.string().max(1000).nullable().optional(),
  electronicUrl: z.string().url().nullable().optional(),
  officeRoom: z.string().max(200).nullable().optional(),
  hoursText: z.string().max(1000).nullable().optional(),
  deadlineText: z.string().max(1000).nullable().optional(),
  requiredCopies: z.number().int().min(1).max(20).nullable().optional(),
  signatureInstructions: z.string().max(3000).nullable().optional(),
  attachmentsNote: z.string().max(3000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional()
});

const submissionInstructionDraftSchema = z.object({
  fundingCallId: z.string().min(1),
  instruction: submissionInstructionSchema,
  sourceUrl: z.string().url(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

app.post('/v1/internal/submission-instructions/upsert-draft', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = submissionInstructionDraftSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_SUBMISSION_INSTRUCTION_DRAFT',
      details: parsed.error.flatten()
    });
  }

  const call = await prisma.fundingCall.findUnique({
    where: { id: parsed.data.fundingCallId },
    select: {
      id: true,
      officialUrl: true,
      verificationStatus: true,
      verifiedAt: true
    }
  });

  if (!call) {
    return reply.code(404).send({ error: 'FUNDING_CALL_NOT_FOUND' });
  }

  const sameSource = await prisma.submissionInstructionVersion.findFirst({
    where: {
      fundingCallId: call.id,
      sourceUrl: parsed.data.sourceUrl,
      sourceHash: parsed.data.sourceHash ?? null
    },
    orderBy: { version: 'desc' }
  });

  if (sameSource?.status === 'VERIFIED') {
    return {
      instruction: sameSource,
      protected: true,
      reason: 'VERIFIED_INSTRUCTION_CANNOT_BE_OVERWRITTEN_BY_AUTOMATION'
    };
  }

  let result;
  if (sameSource) {
    result = await prisma.submissionInstructionVersion.update({
      where: { id: sameSource.id },
      data: {
        instructionJson: parsed.data.instruction as never,
        status: 'DRAFT',
        analyzedAt: new Date(),
        verifiedAt: null
      }
    });
  } else {
    const latest = await prisma.submissionInstructionVersion.findFirst({
      where: { fundingCallId: call.id },
      orderBy: { version: 'desc' },
      select: { version: true }
    });

    result = await prisma.submissionInstructionVersion.create({
      data: {
        fundingCallId: call.id,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        instructionJson: parsed.data.instruction as never,
        sourceUrl: parsed.data.sourceUrl,
        sourceHash: parsed.data.sourceHash ?? null,
        analyzedAt: new Date()
      }
    });
  }

  return { instruction: result, protected: false };
});

const verifySubmissionInstructionSchema = z.object({
  instruction: submissionInstructionSchema.optional()
});

app.post('/v1/internal/submission-instructions/:id/verify', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = verifySubmissionInstructionSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_SUBMISSION_INSTRUCTION_VERIFICATION',
      details: parsed.error.flatten()
    });
  }

  const existing = await prisma.submissionInstructionVersion.findUnique({
    where: { id },
    include: {
      fundingCall: {
        include: { source: true }
      }
    }
  });

  if (!existing) {
    return reply.code(404).send({ error: 'SUBMISSION_INSTRUCTION_NOT_FOUND' });
  }

  if (
    existing.fundingCall.verificationStatus !== 'VERIFIED' ||
    !existing.fundingCall.verifiedAt
  ) {
    return reply.code(409).send({ error: 'VERIFIED_FUNDING_CALL_REQUIRED' });
  }

  const verified = await prisma.submissionInstructionVersion.update({
    where: { id },
    data: {
      instructionJson: parsed.data.instruction === undefined
        ? existing.instructionJson
        : parsed.data.instruction as never,
      status: 'VERIFIED',
      verifiedAt: new Date()
    }
  });

  await prisma.changeEvent.create({
    data: {
      sourceId: existing.fundingCall.sourceId,
      changeType: 'SUBMISSION_INSTRUCTION_VERIFIED',
      severity: 'INFORMATION',
      summary: `Zweryfikowano instrukcję złożenia dla naboru: ${existing.fundingCall.title}`,
      verified: true,
      verifiedAt: new Date(),
      verificationScore: 100,
      payload: {
        fundingCallId: existing.fundingCallId,
        submissionInstructionId: verified.id,
        sourceUrl: verified.sourceUrl,
        sourceHash: verified.sourceHash
      }
    }
  });

  return { instruction: verified };
});

const verifyChangeSchema = z.object({
  verified: z.boolean(),
  verificationScore: z.number().int().min(0).max(100).optional()
});

app.post('/v1/internal/change-events/:id/verify', async (request, reply) => {
  requireWorkerSecret(request);
  const id = (request.params as { id: string }).id;
  const parsed = verifyChangeSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_CHANGE_VERIFICATION' });
  }

  const event = await prisma.changeEvent.findUnique({ where: { id } });
  if (!event) {
    return reply.code(404).send({ error: 'CHANGE_EVENT_NOT_FOUND' });
  }

  const updated = await prisma.changeEvent.update({
    where: { id },
    data: {
      verified: parsed.data.verified,
      verificationScore: parsed.data.verificationScore ?? null,
      verifiedAt: parsed.data.verified ? new Date() : null,
      requalificationProcessedAt: null
    }
  });

  return { event: updated };
});

function qualificationContextFor(
  profile: {
    voivodeship: string | null;
    municipality: string | null;
    regionVerified: boolean;
    pupOfficeId: string | null;
  } | null,
  funding: {
    employmentStatus: string | null;
    wantsToStartBusiness: boolean | null;
    businessActiveLast12Months: boolean | null;
    priorNonRepayableStartupAid: boolean | null;
  } | null
) {
  return {
    employmentStatus: funding?.employmentStatus,
    wantsToStartBusiness: funding?.wantsToStartBusiness,
    voivodeship: profile?.voivodeship,
    municipality: profile?.municipality,
    regionVerified: profile?.regionVerified,
    pupOfficeId: profile?.pupOfficeId,
    businessActiveLast12Months: funding?.businessActiveLast12Months,
    priorNonRepayableStartupAid: funding?.priorNonRepayableStartupAid
  };
}

app.post('/v1/internal/requalify-verified-changes', async (request) => {
  requireWorkerSecret(request);

  const events = await prisma.changeEvent.findMany({
    where: {
      verified: true,
      requalificationProcessedAt: null
    },
    orderBy: { detectedAt: 'asc' },
    take: 100
  });

  let snapshotsCreated = 0;
  let alertsCreated = 0;
  let casesChecked = 0;

  for (const event of events) {
    const source = event.sourceId
      ? await prisma.source.findUnique({
          where: { id: event.sourceId },
          include: { institution: true }
        })
      : null;

    const cases = await prisma.case.findMany({
      where: {
        status: {
          notIn: ['CLOSED', 'REJECTED', 'SUBMITTED']
        }
      },
      include: {
        user: {
          include: {
            profile: true,
            fundingProfile: true
          }
        },
        qualifications: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    for (const item of cases) {
      const profile = item.user.profile;
      if (!profile) continue;

      if (!eventAppliesToRegion(event.payload, profile)) {
        continue;
      }

      if (
        source?.institution?.type === 'PUP' &&
        source.institutionId &&
        profile.pupOfficeId !== source.institutionId
      ) {
        continue;
      }

      casesChecked++;

      const previous = item.qualifications[0];
      const qualification = qualifyPupStartup(
        qualificationContextFor(profile, item.user.fundingProfile)
      );

      const result = {
        engineVersion: QUALIFICATION_ENGINE_VERSION,
        generatedAt: new Date().toISOString(),
        caseId: item.id,
        trigger: {
          changeEventId: event.id,
          sourceId: event.sourceId,
          changeType: event.changeType
        },
        paths: [qualification]
      };

      const snapshot = await prisma.qualificationSnapshot.create({
        data: {
          caseId: item.id,
          status: qualification.status,
          engineVersion: QUALIFICATION_ENGINE_VERSION,
          resultJson: result as never,
          sourceRefs: qualification.sourceRefs as never
        }
      });
      snapshotsCreated++;

      if (previous && previous.status !== qualification.status) {
        const dedupeKey = `qualification-change:${event.id}:${item.id}`;

        await prisma.notification.upsert({
          where: {
            userId_dedupeKey: {
              userId: item.userId,
              dedupeKey
            }
          },
          update: {
            category: 'QUALIFICATION_CHANGE',
            priority: qualification.status === 'NOT_MATCH_THIS_PATH' ? 'P1' : 'P2',
            title: 'Zmiana w kwalifikacji sprawy',
            body: `Po zweryfikowanej zmianie oficjalnego źródła wynik tej ścieżki zmienił się z ${previous.status} na ${qualification.status}. Otwórz sprawę, aby zobaczyć powód i źródło.`,
            changeEventId: event.id,
            scheduledAt: new Date(),
            failedAt: null,
            failureReason: null
          },
          create: {
            userId: item.userId,
            category: 'QUALIFICATION_CHANGE',
            priority: qualification.status === 'NOT_MATCH_THIS_PATH' ? 'P1' : 'P2',
            title: 'Zmiana w kwalifikacji sprawy',
            body: `Po zweryfikowanej zmianie oficjalnego źródła wynik tej ścieżki zmienił się z ${previous.status} na ${qualification.status}. Otwórz sprawę, aby zobaczyć powód i źródło.`,
            changeEventId: event.id,
            scheduledAt: new Date(),
            dedupeKey
          }
        });

        alertsCreated++;
      }

      await prisma.auditEvent.create({
        data: {
          userId: item.userId,
          actorType: 'SYSTEM',
          action: 'CASE_REQUALIFIED_AFTER_VERIFIED_CHANGE',
          entity: 'QualificationSnapshot',
          entityId: snapshot.id,
          metadata: {
            caseId: item.id,
            changeEventId: event.id,
            previousStatus: previous?.status ?? null,
            currentStatus: qualification.status
          }
        }
      });
    }

    await prisma.changeEvent.update({
      where: { id: event.id },
      data: { requalificationProcessedAt: new Date() }
    });
  }

  return {
    eventsProcessed: events.length,
    casesChecked,
    snapshotsCreated,
    alertsCreated
  };
});

function eventAppliesToRegion(
  payload: unknown,
  profile: { voivodeship: string | null; county: string | null; municipality: string | null }
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;
  const p = payload as Record<string, unknown>;
  const v = typeof p.scopeVoivodeship === 'string' ? p.scopeVoivodeship : null;
  const c = typeof p.scopeCounty === 'string' ? p.scopeCounty : null;
  const m = typeof p.scopeMunicipality === 'string' ? p.scopeMunicipality : null;

  if (v && v !== profile.voivodeship) return false;
  if (c && c !== profile.county) return false;
  if (m && m !== profile.municipality) return false;
  return true;
}

function daysUntil(date: Date, now: Date) {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

app.post('/v1/internal/build-digests', async (request) => {
  requireWorkerSecret(request);
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [changes, calls, users] = await Promise.all([
    prisma.changeEvent.findMany({
      where: { verified: true, detectedAt: { gte: since } },
      orderBy: { detectedAt: 'desc' },
      take: 200
    }),
    prisma.fundingCall.findMany({
      where: {
        verifiedAt: { not: null },
        OR: [
          { opensAt: { gte: now, lte: horizon } },
          { closesAt: { gte: now, lte: horizon } }
        ]
      },
      include: { institution: true },
      orderBy: [{ opensAt: 'asc' }, { closesAt: 'asc' }],
      take: 200
    }),
    prisma.user.findMany({
      where: {
        notificationPreference: {
          is: { morningDigest: true, telegramWriteAccess: true }
        }
      },
      include: { profile: true, notificationPreference: true }
    })
  ]);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const digestDate = formatter.format(now);
  let created = 0;

  for (const user of users) {
    if (!user.profile) continue;
    const profile = user.profile;
    const lines: string[] = [];

    for (const event of changes) {
      if (!eventAppliesToRegion(event.payload, profile)) continue;
      lines.push(event.summary);
      if (lines.length >= 3) break;
    }

    for (const call of calls) {
      if (lines.length >= 3) break;
      const institution = call.institution;
      if (institution.voivodeship && institution.voivodeship !== profile.voivodeship) continue;
      if (institution.county && institution.county !== profile.county) continue;
      if (institution.municipality && institution.municipality !== profile.municipality) continue;

      if (call.opensAt && call.opensAt >= now && call.opensAt <= horizon) {
        const d = daysUntil(call.opensAt, now);
        lines.push(d <= 1 ? `Jutro rusza nabór: ${call.title}` : `Za ${d} dni rusza nabór: ${call.title}`);
      } else if (call.closesAt && call.closesAt >= now && call.closesAt <= horizon) {
        const d = daysUntil(call.closesAt, now);
        lines.push(d <= 1 ? `Ostatni dzień na wniosek: ${call.title}` : `${d} dni do zamknięcia: ${call.title}`);
      }
    }

    if (lines.length === 0) continue;

    const dedupeKey = `morning-digest:${digestDate}`;
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
      update: {
        title: 'DotacjaPRO — poranny skrót',
        body: lines.map((line) => `• ${line}`).join('\n'),
        scheduledAt: now,
        failedAt: null,
        failureReason: null
      },
      create: {
        userId: user.id,
        category: 'MORNING_DIGEST',
        priority: 'P5',
        title: 'DotacjaPRO — poranny skrót',
        body: lines.map((line) => `• ${line}`).join('\n'),
        scheduledAt: now,
        dedupeKey
      }
    });
    created++;
  }

  return { created, usersChecked: users.length };
});

app.get('/v1/internal/notifications/pending', async (request) => {
  requireWorkerSecret(request);
  const rawLimit = Number((request.query as { limit?: string }).limit ?? 100);
  const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 100));
  const now = new Date();

  const notifications = await prisma.notification.findMany({
    where: {
      sentAt: null,
      failedAt: null,
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      user: {
        notificationPreference: { is: { telegramWriteAccess: true } }
      }
    },
    include: {
      user: { select: { telegramUserId: true } }
    },
    orderBy: [{ priority: 'asc' }, { scheduledAt: 'asc' }],
    take: limit
  });

  return {
    notifications: notifications.map((item) => ({
      id: item.id,
      telegramUserId: item.user.telegramUserId,
      title: item.title,
      body: item.body,
      category: item.category,
      priority: item.priority
    }))
  };
});

const deliverySchema = z.object({
  success: z.boolean(),
  error: z.string().max(2000).optional()
});

app.post('/v1/internal/notifications/:id/delivery', async (request, reply) => {
  requireWorkerSecret(request);
  const parsed = deliverySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_DELIVERY_REPORT' });

  const id = (request.params as { id: string }).id;
  const exists = await prisma.notification.findUnique({ where: { id } });
  if (!exists) return reply.code(404).send({ error: 'NOTIFICATION_NOT_FOUND' });

  const notification = await prisma.notification.update({
    where: { id },
    data: parsed.data.success
      ? { sentAt: new Date(), failedAt: null, failureReason: null }
      : { failedAt: new Date(), failureReason: parsed.data.error ?? 'Unknown Telegram delivery error' }
  });

  return { notificationId: notification.id, success: parsed.data.success };
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
