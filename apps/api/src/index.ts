import Fastify, { type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import cors from '@fastify/cors';
import { z } from 'zod';
import { prisma } from '@dotacjapro/db';
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


app.get('/v1/cases/:caseId/form-questions', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const query = z.object({ templateId: z.string().min(1) }).safeParse(request.query);
  if (!query.success) return reply.code(400).send({ error: 'TEMPLATE_ID_REQUIRED' });

  const [item, template] = await Promise.all([
    prisma.case.findFirst({
      where: { id: caseId, userId }
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

const renderRequestSchema = z.object({
  templateId: z.string().min(1)
});

app.post('/v1/cases/:caseId/render', async (request, reply) => {
  const userId = await requireUserId(request);
  const caseId = (request.params as { caseId: string }).caseId;
  const parsed = renderRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RENDER_REQUEST' });

  const item = await prisma.case.findFirst({
    where: { id: caseId, userId }
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
        mappingVerifiedAt: parsed.data.mappingStatus === 'VERIFIED' ? new Date() : null,
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

  if (!parsed.data.success) {
    const failed = await prisma.documentRenderJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: parsed.data.errorCode,
        errorMessage: parsed.data.errorMessage,
        completedAt: new Date()
      }
    });
    return { job: failed };
  }

  const result = await prisma.$transaction(async (tx) => {
    const completed = await tx.documentRenderJob.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        outputStorageKey: parsed.data.outputStorageKey,
        outputSha256: parsed.data.outputSha256,
        outputMimeType: parsed.data.outputMimeType,
        outputName: parsed.data.outputName,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });

    const document = await tx.caseDocument.upsert({
      where: { renderJobId: id },
      update: {
        storageKey: parsed.data.outputStorageKey,
        originalName: parsed.data.outputName,
        mimeType: parsed.data.outputMimeType,
        templateHash: job.template.sourceDocument.sha256,
        sourceDocumentId: job.template.sourceDocument.id
      },
      create: {
        caseId: job.caseId,
        type: 'FILLED_OFFICIAL_FORM',
        originalName: parsed.data.outputName,
        mimeType: parsed.data.outputMimeType,
        storageKey: parsed.data.outputStorageKey,
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
        outputSha256: parsed.data.outputSha256
      }
    }
  });

  return {
    job: result.completed,
    document: result.document
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
