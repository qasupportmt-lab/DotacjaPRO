export interface EligibilityContext {
  employmentStatus: string;
  voivodeship: string;
  municipality?: string;
  businessActiveLast12Months?: boolean;
  priorNonRepayableStartupAid?: boolean;
}

export interface RuleResult {
  ruleId: string;
  passed: boolean | null;
  reason: string;
  sourceId: string;
  sourceVersionId: string;
}

export function evaluateCorePupRules(ctx: EligibilityContext): RuleResult[] {
  return [
    {
      ruleId: 'PUP-CORE-STATUS',
      passed: ctx.employmentStatus === 'UNEMPLOYED_REGISTERED',
      reason: 'Ścieżka PUP wymaga weryfikacji ustawowego statusu wnioskodawcy.',
      sourceId: 'LEGAL-SOURCE-PENDING',
      sourceVersionId: 'LEGAL-SOURCE-VERSION-PENDING'
    }
  ];
}
