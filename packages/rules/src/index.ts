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


export const LOCAL_CRITERIA_ENGINE_VERSION = '2026-10-03.1';

export interface LocalCriterionDefinition {
  code: string;
  title: string;
  description?: string | null;
  maxPoints?: number | null;
  failIfZero?: boolean;
  scoringJson?: unknown;
  evidenceHint?: string | null;
}

export interface LocalCriterionSetDefinition {
  id: string;
  version: number;
  sourceHash: string;
  minimumPoints?: number | null;
  maximumPoints?: number | null;
  criteria: LocalCriterionDefinition[];
}

export type LocalCriterionAnswer = string | number | boolean | null | undefined;

export interface LocalCriterionQuestion {
  code: string;
  title: string;
  description?: string | null;
  inputType: 'BOOLEAN' | 'SELECT' | 'NUMBER' | 'EVIDENCE';
  required: boolean;
  failIfZero: boolean;
  maxPoints?: number | null;
  evidenceHint?: string | null;
  options?: Array<{ value: string; label: string }>;
}

export type CriterionScoreState =
  | 'SCORED'
  | 'MISSING'
  | 'NEEDS_REVIEW'
  | 'INVALID_CONFIGURATION';

export interface CriterionScoreResult {
  code: string;
  title: string;
  state: CriterionScoreState;
  points: number | null;
  maxPoints: number | null;
  answer: LocalCriterionAnswer;
  reason: string;
  blockingFailure: boolean;
  blockingUnknown: boolean;
}

export type LocalCriteriaAssessmentStatus =
  | 'LOCAL_THRESHOLD_MET'
  | 'BELOW_LOCAL_THRESHOLD'
  | 'BLOCKING_CRITERION_FAILED'
  | 'NEEDS_REVIEW'
  | 'SCORING_COMPLETE_NO_THRESHOLD';

export interface LocalCriteriaAssessmentResult {
  engineVersion: string;
  criterionSetId: string;
  criterionSetVersion: number;
  sourceHash: string;
  status: LocalCriteriaAssessmentStatus;
  knownPoints: number;
  possiblePoints: number;
  publishedMaximumPoints: number | null;
  minimumPoints: number | null;
  thresholdMet: boolean | null;
  blockingFailures: string[];
  unresolvedCriteria: string[];
  results: CriterionScoreResult[];
  summary: string;
}

type BooleanScoring = {
  type: 'BOOLEAN';
  question?: string;
  required?: boolean;
  truePoints: number;
  falsePoints: number;
  trueLabel?: string;
  falseLabel?: string;
};

type EnumScoring = {
  type: 'ENUM';
  question?: string;
  required?: boolean;
  options: Array<{
    value: string;
    label?: string;
    points: number;
  }>;
};

type NumberBand = {
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
  points: number;
  label?: string;
};

type NumberBandsScoring = {
  type: 'NUMBER_BANDS';
  question?: string;
  required?: boolean;
  bands: NumberBand[];
};

type ManualReviewScoring = {
  type: 'MANUAL_REVIEW';
  question?: string;
  required?: boolean;
};

type SupportedScoring =
  | BooleanScoring
  | EnumScoring
  | NumberBandsScoring
  | ManualReviewScoring;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scoringType(value: unknown): string | null {
  const record = asRecord(value);
  return record && typeof record.type === 'string' ? record.type : null;
}

function normalizeSupportedScoring(value: unknown): SupportedScoring | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string') return null;

  const required = typeof record.required === 'boolean' ? record.required : true;
  const question = typeof record.question === 'string' ? record.question : undefined;

  if (record.type === 'BOOLEAN') {
    const truePoints = finiteNumber(record.truePoints);
    const falsePoints = finiteNumber(record.falsePoints);
    if (truePoints === null || falsePoints === null) return null;
    return {
      type: 'BOOLEAN',
      required,
      question,
      truePoints,
      falsePoints,
      trueLabel: typeof record.trueLabel === 'string' ? record.trueLabel : undefined,
      falseLabel: typeof record.falseLabel === 'string' ? record.falseLabel : undefined
    };
  }

  if (record.type === 'ENUM') {
    if (!Array.isArray(record.options) || record.options.length === 0) return null;
    const options = [];
    for (const raw of record.options) {
      const option = asRecord(raw);
      if (!option || typeof option.value !== 'string') return null;
      const points = finiteNumber(option.points);
      if (points === null) return null;
      options.push({
        value: option.value,
        label: typeof option.label === 'string' ? option.label : undefined,
        points
      });
    }
    return { type: 'ENUM', required, question, options };
  }

  if (record.type === 'NUMBER_BANDS') {
    if (!Array.isArray(record.bands) || record.bands.length === 0) return null;
    const bands = [];
    for (const raw of record.bands) {
      const band = asRecord(raw);
      if (!band) return null;
      const points = finiteNumber(band.points);
      if (points === null) return null;
      const min = band.min === undefined ? undefined : finiteNumber(band.min);
      const max = band.max === undefined ? undefined : finiteNumber(band.max);
      if (band.min !== undefined && min === null) return null;
      if (band.max !== undefined && max === null) return null;
      bands.push({
        min: min ?? undefined,
        max: max ?? undefined,
        minInclusive: typeof band.minInclusive === 'boolean' ? band.minInclusive : true,
        maxInclusive: typeof band.maxInclusive === 'boolean' ? band.maxInclusive : true,
        points,
        label: typeof band.label === 'string' ? band.label : undefined
      });
    }
    return { type: 'NUMBER_BANDS', required, question, bands };
  }

  if (record.type === 'MANUAL_REVIEW') {
    return { type: 'MANUAL_REVIEW', required, question };
  }

  return null;
}

function pointsWithinLimit(points: number, maxPoints: number | null): boolean {
  if (!Number.isFinite(points) || points < 0) return false;
  if (maxPoints === null) return true;
  return points <= maxPoints;
}

function scoreOneCriterion(
  criterion: LocalCriterionDefinition,
  answer: LocalCriterionAnswer
): CriterionScoreResult {
  const maxPoints = criterion.maxPoints == null ? null : Number(criterion.maxPoints);
  const type = scoringType(criterion.scoringJson);
  const scoring = normalizeSupportedScoring(criterion.scoringJson);
  const missing = answer === null || answer === undefined || answer === '';

  if (!scoring) {
    return {
      code: criterion.code,
      title: criterion.title,
      state: type === 'AUTO_EXTRACTED_MAX_POINTS' ? 'NEEDS_REVIEW' : 'INVALID_CONFIGURATION',
      points: null,
      maxPoints,
      answer,
      reason: type === 'AUTO_EXTRACTED_MAX_POINTS'
        ? 'Kryterium zostało wykryte automatycznie i nie ma zatwierdzonej reguły punktowej.'
        : 'Brak obsługiwanej, zweryfikowanej reguły punktowej.',
      blockingFailure: false,
      blockingUnknown: Boolean(criterion.failIfZero)
    };
  }

  if (scoring.type === 'MANUAL_REVIEW') {
    return {
      code: criterion.code,
      title: criterion.title,
      state: 'NEEDS_REVIEW',
      points: null,
      maxPoints,
      answer,
      reason: 'To kryterium wymaga oceny człowieka zgodnie z oficjalnymi zasadami.',
      blockingFailure: false,
      blockingUnknown: Boolean(criterion.failIfZero)
    };
  }

  if (missing) {
    if (scoring.required === false) {
      return {
        code: criterion.code,
        title: criterion.title,
        state: 'SCORED',
        points: 0,
        maxPoints,
        answer,
        reason: 'Kryterium opcjonalne pozostawiono bez odpowiedzi; naliczono 0 pkt.',
        blockingFailure: Boolean(criterion.failIfZero),
        blockingUnknown: false
      };
    }

    return {
      code: criterion.code,
      title: criterion.title,
      state: 'MISSING',
      points: null,
      maxPoints,
      answer,
      reason: 'Brakuje odpowiedzi potrzebnej do obliczenia punktów.',
      blockingFailure: false,
      blockingUnknown: Boolean(criterion.failIfZero)
    };
  }

  let points: number | null = null;

  if (scoring.type === 'BOOLEAN') {
    if (typeof answer !== 'boolean') {
      return {
        code: criterion.code,
        title: criterion.title,
        state: 'MISSING',
        points: null,
        maxPoints,
        answer,
        reason: 'Odpowiedź musi mieć wartość TAK/NIE.',
        blockingFailure: false,
        blockingUnknown: Boolean(criterion.failIfZero)
      };
    }
    points = answer ? scoring.truePoints : scoring.falsePoints;
  }

  if (scoring.type === 'ENUM') {
    const option = scoring.options.find((item) => item.value === String(answer));
    if (!option) {
      return {
        code: criterion.code,
        title: criterion.title,
        state: 'MISSING',
        points: null,
        maxPoints,
        answer,
        reason: 'Wybrana odpowiedź nie występuje w zweryfikowanej tabeli punktowej.',
        blockingFailure: false,
        blockingUnknown: Boolean(criterion.failIfZero)
      };
    }
    points = option.points;
  }

  if (scoring.type === 'NUMBER_BANDS') {
    const numeric = typeof answer === 'number' ? answer : Number(answer);
    if (!Number.isFinite(numeric)) {
      return {
        code: criterion.code,
        title: criterion.title,
        state: 'MISSING',
        points: null,
        maxPoints,
        answer,
        reason: 'Odpowiedź musi być liczbą.',
        blockingFailure: false,
        blockingUnknown: Boolean(criterion.failIfZero)
      };
    }

    const band = scoring.bands.find((item) => {
      const minOk = item.min === undefined
        ? true
        : item.minInclusive === false ? numeric > item.min : numeric >= item.min;
      const maxOk = item.max === undefined
        ? true
        : item.maxInclusive === false ? numeric < item.max : numeric <= item.max;
      return minOk && maxOk;
    });

    if (!band) {
      return {
        code: criterion.code,
        title: criterion.title,
        state: 'MISSING',
        points: null,
        maxPoints,
        answer,
        reason: 'Wartość nie mieści się w żadnym zweryfikowanym przedziale punktowym.',
        blockingFailure: false,
        blockingUnknown: Boolean(criterion.failIfZero)
      };
    }

    points = band.points;
  }

  if (points === null || !pointsWithinLimit(points, maxPoints)) {
    return {
      code: criterion.code,
      title: criterion.title,
      state: 'INVALID_CONFIGURATION',
      points: null,
      maxPoints,
      answer,
      reason: 'Zweryfikowana konfiguracja punktowa jest niespójna z maksymalną liczbą punktów.',
      blockingFailure: false,
      blockingUnknown: Boolean(criterion.failIfZero)
    };
  }

  return {
    code: criterion.code,
    title: criterion.title,
    state: 'SCORED',
    points,
    maxPoints,
    answer,
    reason: 'Punkty obliczono wyłącznie z zatwierdzonej reguły punktowej.',
    blockingFailure: Boolean(criterion.failIfZero && points === 0),
    blockingUnknown: false
  };
}

export function buildLocalCriterionQuestions(
  criteria: LocalCriterionDefinition[]
): LocalCriterionQuestion[] {
  return criteria.map((criterion) => {
    const scoring = normalizeSupportedScoring(criterion.scoringJson);
    const base = {
      code: criterion.code,
      title: scoring?.question ?? criterion.title,
      description: criterion.description,
      required: scoring?.required ?? true,
      failIfZero: Boolean(criterion.failIfZero),
      maxPoints: criterion.maxPoints,
      evidenceHint: criterion.evidenceHint
    };

    if (!scoring || scoring.type === 'MANUAL_REVIEW') {
      return {
        ...base,
        inputType: 'EVIDENCE' as const
      };
    }

    if (scoring.type === 'BOOLEAN') {
      return {
        ...base,
        inputType: 'BOOLEAN' as const,
        options: [
          { value: 'true', label: scoring.trueLabel ?? 'Tak' },
          { value: 'false', label: scoring.falseLabel ?? 'Nie' }
        ]
      };
    }

    if (scoring.type === 'ENUM') {
      return {
        ...base,
        inputType: 'SELECT' as const,
        options: scoring.options.map((option) => ({
          value: option.value,
          label: option.label ?? option.value
        }))
      };
    }

    return {
      ...base,
      inputType: 'NUMBER' as const
    };
  });
}

export function assessLocalCriteria(
  set: LocalCriterionSetDefinition,
  answers: Record<string, LocalCriterionAnswer>
): LocalCriteriaAssessmentResult {
  const results = set.criteria.map((criterion) =>
    scoreOneCriterion(criterion, answers[criterion.code])
  );

  const knownPoints = results.reduce(
    (sum, item) => sum + (item.points ?? 0),
    0
  );

  const declaredCriteriaMaximum = set.criteria.reduce(
    (sum, item) => sum + (item.maxPoints ?? 0),
    0
  );

  const unresolvedKnownMaximum = results.reduce(
    (sum, item) =>
      item.state === 'SCORED'
        ? sum
        : sum + (item.maxPoints ?? 0),
    0
  );

  const publishedMaximumPoints = set.maximumPoints ?? null;
  const residualUnknownMaximum = publishedMaximumPoints === null
    ? 0
    : Math.max(0, publishedMaximumPoints - declaredCriteriaMaximum);

  const possiblePoints = knownPoints + unresolvedKnownMaximum + residualUnknownMaximum;
  const blockingFailures = results
    .filter((item) => item.blockingFailure)
    .map((item) => item.code);
  const blockingUnknown = results.some((item) => item.blockingUnknown);
  const unresolvedCriteria = results
    .filter((item) => item.state !== 'SCORED')
    .map((item) => item.code);

  const minimumPoints = set.minimumPoints ?? null;
  let status: LocalCriteriaAssessmentStatus;
  let thresholdMet: boolean | null = null;

  if (blockingFailures.length > 0) {
    status = 'BLOCKING_CRITERION_FAILED';
    thresholdMet = false;
  } else if (minimumPoints !== null && possiblePoints < minimumPoints) {
    status = 'BELOW_LOCAL_THRESHOLD';
    thresholdMet = false;
  } else if (unresolvedCriteria.length > 0 || blockingUnknown) {
    status = 'NEEDS_REVIEW';
  } else if (minimumPoints !== null) {
    thresholdMet = knownPoints >= minimumPoints;
    status = thresholdMet ? 'LOCAL_THRESHOLD_MET' : 'BELOW_LOCAL_THRESHOLD';
  } else {
    status = 'SCORING_COMPLETE_NO_THRESHOLD';
  }

  const summaryByStatus: Record<LocalCriteriaAssessmentStatus, string> = {
    LOCAL_THRESHOLD_MET:
      'Według zweryfikowanej lokalnej tabeli punktowej obliczony wynik osiąga opublikowany próg. Nie oznacza to przyznania dofinansowania ani pozytywnej decyzji urzędu.',
    BELOW_LOCAL_THRESHOLD:
      'Według zweryfikowanej lokalnej tabeli punktowej wynik nie osiąga opublikowanego progu przy obecnych danych.',
    BLOCKING_CRITERION_FAILED:
      'Co najmniej jedno zweryfikowane kryterium blokujące ma wynik, który zgodnie z lokalnymi zasadami zatrzymuje tę ocenę.',
    NEEDS_REVIEW:
      'Nie można jeszcze bezpiecznie zakończyć punktacji: brakuje odpowiedzi albo co najmniej jedno kryterium wymaga oceny człowieka.',
    SCORING_COMPLETE_NO_THRESHOLD:
      'Punkty obliczono z dostępnych zweryfikowanych reguł, ale w zestawie nie ma opublikowanego progu pozwalającego porównać wynik.'
  };

  return {
    engineVersion: LOCAL_CRITERIA_ENGINE_VERSION,
    criterionSetId: set.id,
    criterionSetVersion: set.version,
    sourceHash: set.sourceHash,
    status,
    knownPoints,
    possiblePoints,
    publishedMaximumPoints,
    minimumPoints,
    thresholdMet,
    blockingFailures,
    unresolvedCriteria,
    results,
    summary: summaryByStatus[status]
  };
}
