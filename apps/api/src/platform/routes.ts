import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@dotacjapro/db';

type PlatformRouteDeps = {
  requireUserId: (request: FastifyRequest) => Promise<string>;
};

const PRODUCT_CATALOG = [
  {
    code: 'GRANTS',
    label: 'Dotacje',
    description: 'Programy publiczne, PUP, Fundusze Europejskie i dokumentacja.',
    engine: 'GRANT_ENGINE',
    availability: 'ACTIVE',
    requiresRegulatedPartner: false
  },
  {
    code: 'BUSINESS_FINANCE',
    label: 'Finansowanie firmy',
    description: 'Mapa możliwych źródeł finansowania firmy.',
    engine: 'FINANCIAL_PARTNER_ENGINE',
    availability: 'PLANNED',
    requiresRegulatedPartner: true
  },
  {
    code: 'LEASING',
    label: 'Leasing',
    description: 'Analiza potrzeby i routing do zweryfikowanego partnera.',
    engine: 'LEASING_ROUTER',
    availability: 'PLANNED',
    requiresRegulatedPartner: true
  },
  {
    code: 'CREDIT',
    label: 'Kredyty',
    description: 'Wstępna analiza potrzeb i przekazanie do właściwego partnera.',
    engine: 'CREDIT_ROUTER',
    availability: 'PLANNED',
    requiresRegulatedPartner: true
  },
  {
    code: 'INSURANCE',
    label: 'Ubezpieczenia',
    description: 'Wybór kategorii ochrony i routing do uprawnionego partnera.',
    engine: 'INSURANCE_ROUTER',
    availability: 'PLANNED',
    requiresRegulatedPartner: true
  },
  {
    code: 'PROPERTY',
    label: 'Nieruchomości',
    description: 'Potrzeba, region i przekazanie do właściwego partnera.',
    engine: 'PROPERTY_ROUTER',
    availability: 'PLANNED',
    requiresRegulatedPartner: true
  },
  {
    code: 'DOCUMENTS',
    label: 'Dokumenty i formalności',
    description: 'Dokumenty tworzone z wykorzystaniem zweryfikowanych danych i źródeł.',
    engine: 'DOCUMENT_ENGINE',
    availability: 'ACTIVE',
    requiresRegulatedPartner: false
  }
] as const;

function completion(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function registerPlatformRoutes(
  app: FastifyInstance,
  deps: PlatformRouteDeps
) {
  app.get('/v1/platform/products', async () => {
    const [verifiedCalls, verifiedForms] = await Promise.all([
      prisma.fundingCall.count({
        where: {
          verificationStatus: 'VERIFIED',
          status: { in: ['ANNOUNCED', 'OPEN'] }
        }
      }),
      prisma.officialFormTemplate.count({
        where: {
          active: true,
          mappingStatus: 'VERIFIED',
          mappingVerifiedAt: { not: null }
        }
      })
    ]);

    const products = PRODUCT_CATALOG.map((product) => {
      if (product.code === 'GRANTS') {
        return {
          ...product,
          availability: verifiedCalls > 0 ? 'ACTIVE' : 'CONFIGURATION_REQUIRED',
          readiness: { verifiedCalls }
        };
      }

      if (product.code === 'DOCUMENTS') {
        return {
          ...product,
          availability: verifiedForms > 0 ? 'ACTIVE' : 'CONFIGURATION_REQUIRED',
          readiness: { verifiedForms }
        };
      }

      return {
        ...product,
        availability: 'PLANNED',
        readiness: {}
      };
    });

    return {
      version: '2026-10-08.1',
      products
    };
  });

  app.get('/v1/me/profile-360', async (request, reply) => {
    const userId = await deps.requireUserId(request);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        fundingProfile: true,
        notificationPreference: true
      }
    });

    if (!user) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    }

    const profile = {
      identity: {
        userId: user.id,
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        telegramLinked: Boolean(user.telegramUserId),
        preferredLanguage: user.preferredLanguage
      },
      location: {
        voivodeship: user.profile?.voivodeship ?? null,
        county: user.profile?.county ?? null,
        municipality: user.profile?.municipality ?? null,
        city: user.profile?.city ?? null,
        postalCode: user.profile?.postalCode ?? null,
        pupOfficeId: user.profile?.pupOfficeId ?? null,
        wupOfficeId: user.profile?.wupOfficeId ?? null,
        lgdId: user.profile?.lgdId ?? null,
        regionVerified: user.profile?.regionVerified ?? false,
        terytVerified: user.profile?.terytVerified ?? false
      },
      business: {
        employmentStatus: user.fundingProfile?.employmentStatus ?? null,
        wantsToStartBusiness: user.fundingProfile?.wantsToStartBusiness ?? null,
        existingBusinessLegalForm: user.fundingProfile?.existingBusinessLegalForm ?? null,
        plannedLegalForm: user.fundingProfile?.plannedLegalForm ?? null,
        plannedBusinessDescription: user.fundingProfile?.plannedBusinessDescription ?? null,
        plannedPkd: user.fundingProfile?.plannedPkd ?? [],
        businessActiveLast12Months: user.fundingProfile?.businessActiveLast12Months ?? null,
        priorNonRepayableStartupAid: user.fundingProfile?.priorNonRepayableStartupAid ?? null,
        wantsPfronPath: user.fundingProfile?.wantsPfronPath ?? false
      },
      preferences: {
        criticalAlerts: user.notificationPreference?.criticalAlerts ?? true,
        newCalls: user.notificationPreference?.newCalls ?? true,
        legalChanges: user.notificationPreference?.legalChanges ?? true,
        caseChanges: user.notificationPreference?.caseChanges ?? true,
        marketing: user.notificationPreference?.marketing ?? false
      }
    };

    const requiredSignals = [
      ['location.voivodeship', profile.location.voivodeship],
      ['location.city', profile.location.city],
      ['business.employmentStatus', profile.business.employmentStatus],
      ['business.wantsToStartBusiness', profile.business.wantsToStartBusiness]
    ] as const;

    const missing = requiredSignals
      .filter(([, value]) => !completion(value))
      .map(([key]) => key);

    return {
      profile,
      completeness: {
        requiredSignals: requiredSignals.length,
        completedSignals: requiredSignals.length - missing.length,
        missing,
        readyForGrantRouting: missing.length === 0 && profile.location.regionVerified
      },
      provenance: {
        source: 'DORADCYPRO_ACCOUNT',
        assembledAt: new Date().toISOString(),
        writeModel: 'ASK_ONCE_REUSE_WITH_CONSENT'
      }
    };
  });
}
