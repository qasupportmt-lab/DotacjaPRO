export const QUALIFICATION_ENGINE_VERSION = '2026-10-03.1';

export const NATIONAL_PUP_STARTUP_SOURCE = {
  id: 'PSZ-PUP-STARTUP',
  versionId: 'PSZ-PUP-STARTUP-2025-06-13',
  url: 'https://psz.praca.gov.pl/dla-bezrobotnych-i-poszukujacych-pracy/formy-wsparcia/dofinansowanie-podjecia-dzialalnosci-gospodarczej/',
  legalBasis: [
    'Ustawa z dnia 20 marca 2025 r. o rynku pracy i służbach zatrudnienia, art. 147-153',
    'Rozporządzenie MRPiPS z dnia 21 listopada 2025 r. (Dz.U. 2025 poz. 1645)'
  ]
} as const;

export type EmploymentStatus =
  | 'UNEMPLOYED_REGISTERED'
  | 'NOT_WORKING_UNREGISTERED'
  | 'EMPLOYED'
  | 'STUDENT'
  | 'FARMER'
  | 'CIS_GRADUATE'
  | 'KIS_GRADUATE'
  | 'DISABILITY_CARER'
  | 'OTHER';

export type RuleState = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface EligibilityContext {
  employmentStatus: EmploymentStatus | string | null | undefined;
  wantsToStartBusiness?: boolean | null;
  voivodeship?: string | null;
  municipality?: string | null;
  regionVerified?: boolean | null;
  pupOfficeId?: string | null;
  businessActiveLast12Months?: boolean | null;
  priorNonRepayableStartupAid?: boolean | null;
}

export interface RuleResult {
  ruleId: string;
  state: RuleState;
  blocking: boolean;
  reason: string;
  nextQuestion?: string;
  sourceId: string;
  sourceVersionId: string;
  sourceUrl?: string;
}

export type QualificationStatus =
  | 'POTENTIAL_MATCH'
  | 'NEEDS_DATA'
  | 'NOT_MATCH_THIS_PATH'
  | 'NO_ACTIVE_ROUTE';

export interface FundingPathQualification {
  path: 'PUP_STARTUP';
  status: QualificationStatus;
  title: string;
  summary: string;
  rules: RuleResult[];
  requiresLocalRulesVerification: boolean;
  sourceRefs: Array<{
    sourceId: string;
    sourceVersionId: string;
    url?: string;
  }>;
}

function result(
  ruleId: string,
  state: RuleState,
  blocking: boolean,
  reason: string,
  nextQuestion?: string
): RuleResult {
  return {
    ruleId,
    state,
    blocking,
    reason,
    nextQuestion,
    sourceId: NATIONAL_PUP_STARTUP_SOURCE.id,
    sourceVersionId: NATIONAL_PUP_STARTUP_SOURCE.versionId,
    sourceUrl: NATIONAL_PUP_STARTUP_SOURCE.url
  };
}

export function evaluateCorePupRules(ctx: EligibilityContext): RuleResult[] {
  const rules: RuleResult[] = [];

  if (ctx.wantsToStartBusiness === false) {
    rules.push(result(
      'PUP-STARTUP-INTENT',
      'FAIL',
      true,
      'Ta ścieżka dotyczy osób planujących rozpoczęcie działalności gospodarczej.'
    ));
  } else if (ctx.wantsToStartBusiness == null) {
    rules.push(result(
      'PUP-STARTUP-INTENT',
      'UNKNOWN',
      true,
      'Brakuje potwierdzenia, że celem jest rozpoczęcie działalności gospodarczej.',
      'Czy chcesz rozpocząć własną działalność gospodarczą?'
    ));
  } else {
    rules.push(result(
      'PUP-STARTUP-INTENT',
      'PASS',
      true,
      'Cel użytkownika odpowiada ścieżce dofinansowania na podjęcie działalności gospodarczej.'
    ));
  }

  switch (ctx.employmentStatus) {
    case 'UNEMPLOYED_REGISTERED':
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'PASS',
        true,
        'Status zarejestrowanej osoby bezrobotnej mieści się w krajowej grupie adresatów tej formy wsparcia.'
      ));
      break;

    case 'CIS_GRADUATE':
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'PASS',
        true,
        'Absolwent CIS mieści się w krajowej grupie adresatów tej formy wsparcia.'
      ));
      break;

    case 'KIS_GRADUATE':
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'PASS',
        true,
        'Absolwent KIS mieści się w krajowej grupie adresatów tej formy wsparcia.'
      ));
      break;

    case 'DISABILITY_CARER':
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'UNKNOWN',
        true,
        'Opiekun osoby z niepełnosprawnością może należeć do grupy adresatów, ale trzeba potwierdzić wymagany status poszukującego pracy oraz brak zatrudnienia i innej pracy zarobkowej.',
        'Czy jesteś zarejestrowany jako poszukujący pracy oraz jednocześnie nie jesteś zatrudniony i nie wykonujesz innej pracy zarobkowej?'
      ));
      break;

    case null:
    case undefined:
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'UNKNOWN',
        true,
        'Brakuje statusu zawodowego potrzebnego do wstępnej kwalifikacji.',
        'Jaki jest Twój aktualny status zawodowy?'
      ));
      break;

    default:
      rules.push(result(
        'PUP-APPLICANT-CATEGORY',
        'FAIL',
        true,
        'Podany status nie należy do podstawowych krajowych kategorii adresatów tej konkretnej ścieżki PUP.'
      ));
  }

  if (ctx.regionVerified && ctx.pupOfficeId) {
    rules.push(result(
      'PUP-REGIONAL-ROUTING',
      'PASS',
      true,
      'Właściwy urząd pracy został przypisany na podstawie zweryfikowanego źródła regionalnego.'
    ));
  } else {
    rules.push(result(
      'PUP-REGIONAL-ROUTING',
      'UNKNOWN',
      true,
      'Nie mamy jeszcze zweryfikowanego przypisania właściwego PUP dla wskazanej lokalizacji.',
      'Wybierz miejscowość lub gminę z listy zweryfikowanych lokalizacji.'
    ));
  }

  rules.push(result(
    'PUP-LOCAL-RULES',
    'UNKNOWN',
    true,
    'Każdy PUP może stosować dodatkowe warunki i własny regulamin. Muszą zostać sprawdzone na aktualnym oficjalnym ogłoszeniu i regulaminie konkretnego urzędu.',
    'Poczekaj na weryfikację aktualnego naboru i regulaminu właściwego PUP.'
  ));

  return rules;
}

export function qualifyPupStartup(ctx: EligibilityContext): FundingPathQualification {
  const rules = evaluateCorePupRules(ctx);
  const blockingFail = rules.some((rule) => rule.blocking && rule.state === 'FAIL');
  const routing = rules.find((rule) => rule.ruleId === 'PUP-REGIONAL-ROUTING');
  const unknownBlockingExceptLocal = rules.some(
    (rule) =>
      rule.blocking &&
      rule.state === 'UNKNOWN' &&
      rule.ruleId !== 'PUP-LOCAL-RULES'
  );

  let status: QualificationStatus;
  let summary: string;

  if (blockingFail) {
    status = 'NOT_MATCH_THIS_PATH';
    summary = 'Na podstawie obecnych danych ta konkretna ścieżka PUP nie jest dopasowana. System powinien sprawdzić inne źródła finansowania.';
  } else if (routing?.state !== 'PASS') {
    status = 'NO_ACTIVE_ROUTE';
    summary = 'Brakuje zweryfikowanego przypisania właściwego urzędu lub jego aktualnego źródła. Nie można bezpiecznie wskazać ścieżki PUP.';
  } else if (unknownBlockingExceptLocal) {
    status = 'NEEDS_DATA';
    summary = 'Ścieżka może pasować, ale brakuje danych koniecznych do dalszej kwalifikacji.';
  } else {
    status = 'POTENTIAL_MATCH';
    summary = 'Podstawowe warunki krajowe i właściwość urzędu wyglądają zgodnie z tą ścieżką. Ostateczna kwalifikacja wymaga sprawdzenia aktualnego naboru i lokalnego regulaminu PUP.';
  }

  return {
    path: 'PUP_STARTUP',
    status,
    title: 'Jednorazowe środki PUP na podjęcie działalności gospodarczej',
    summary,
    rules,
    requiresLocalRulesVerification: true,
    sourceRefs: [{
      sourceId: NATIONAL_PUP_STARTUP_SOURCE.id,
      sourceVersionId: NATIONAL_PUP_STARTUP_SOURCE.versionId,
      url: NATIONAL_PUP_STARTUP_SOURCE.url
    }]
  };
}
