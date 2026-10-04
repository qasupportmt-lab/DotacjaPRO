export const ACCOUNTING_TIMEZONE = 'Europe/Warsaw';

export const UNREGISTERED_ACTIVITY_LIMIT_GROSZ: Record<number, number> = {
  2026: 1_081_350
};

export type AccountingSaleLike = {
  status: string;
  currency: string;
  amountDueGrosz: number;
  amountReceivedGrosz: number;
  refundedGrosz: number;
  dueAt: Date;
  receivedAt: Date | null;
  refundedAt: Date | null;
  isTest: boolean;
};

export type AccountingExpenseLike = {
  amountGrosz: number;
  incurredAt: Date;
  deductible: boolean;
  documentReference: string | null;
};

const polishDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACCOUNTING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function localDateParts(date: Date) {
  const parts = polishDateFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day')
  };
}

export function polandYear(date: Date) {
  return localDateParts(date).year;
}

export function polandQuarter(date: Date) {
  return Math.floor((localDateParts(date).month - 1) / 3) + 1;
}

export function assertGrosz(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer in grosz`);
  }
}

export function formatPln(grosz: number) {
  assertGrosz(grosz, 'grosz');
  return (grosz / 100).toFixed(2);
}

export function saleCountsForAccounting(sale: AccountingSaleLike) {
  return (
    !sale.isTest &&
    sale.currency === 'PLN' &&
    !['FAILED', 'CANCELLED'].includes(sale.status)
  );
}

export function saleNetDueGrosz(sale: AccountingSaleLike) {
  assertGrosz(sale.amountDueGrosz, 'amountDueGrosz');
  assertGrosz(sale.refundedGrosz, 'refundedGrosz');
  return Math.max(0, sale.amountDueGrosz - sale.refundedGrosz);
}

export function calculateQuarterLimitSummary(
  sales: AccountingSaleLike[],
  year: number,
  quarter: number
) {
  if (!Number.isInteger(year) || quarter < 1 || quarter > 4) {
    throw new Error('Invalid accounting period');
  }

  const limitGrosz = UNREGISTERED_ACTIVITY_LIMIT_GROSZ[year] ?? null;
  const dueRevenueGrosz = sales
    .filter(
      (sale) =>
        saleCountsForAccounting(sale) &&
        polandYear(sale.dueAt) === year &&
        polandQuarter(sale.dueAt) === quarter
    )
    .reduce((sum, sale) => sum + saleNetDueGrosz(sale), 0);

  if (!Number.isSafeInteger(dueRevenueGrosz)) {
    throw new Error('Accounting total exceeded safe integer range');
  }

  return {
    year,
    quarter,
    limitGrosz,
    dueRevenueGrosz,
    remainingGrosz:
      limitGrosz === null ? null : Math.max(0, limitGrosz - dueRevenueGrosz),
    exceededByGrosz:
      limitGrosz === null ? null : Math.max(0, dueRevenueGrosz - limitGrosz),
    thresholdExceeded:
      limitGrosz === null ? null : dueRevenueGrosz > limitGrosz,
    requiresLegalLimitUpdate: limitGrosz === null,
    arithmetic: {
      representation: 'INTEGER_GROSZ',
      computationalErrorPln: '0.000',
      requestedMaximumErrorPln: '0.001'
    }
  };
}

export function calculatePit36ActivityLine(
  sales: AccountingSaleLike[],
  expenses: AccountingExpenseLike[],
  year: number
) {
  let receivedRevenueGrosz = 0;
  let refundsInYearGrosz = 0;
  let deductibleCostsGrosz = 0;
  const reviewReasons = new Set<string>();

  for (const sale of sales) {
    if (!saleCountsForAccounting(sale)) continue;

    if (sale.receivedAt && polandYear(sale.receivedAt) === year) {
      assertGrosz(sale.amountReceivedGrosz, 'amountReceivedGrosz');
      receivedRevenueGrosz += sale.amountReceivedGrosz;
    }

    if (sale.refundedAt && polandYear(sale.refundedAt) === year) {
      assertGrosz(sale.refundedGrosz, 'refundedGrosz');
      refundsInYearGrosz += sale.refundedGrosz;

      if (
        sale.receivedAt &&
        polandYear(sale.receivedAt) !== polandYear(sale.refundedAt)
      ) {
        reviewReasons.add('CROSS_YEAR_REFUND_REQUIRES_TAX_REVIEW');
      }
    }
  }

  for (const expense of expenses) {
    if (polandYear(expense.incurredAt) !== year || !expense.deductible) continue;
    assertGrosz(expense.amountGrosz, 'expense.amountGrosz');

    if (!expense.documentReference?.trim()) {
      reviewReasons.add('EXPENSE_WITHOUT_DOCUMENT_EXCLUDED');
      continue;
    }

    deductibleCostsGrosz += expense.amountGrosz;
  }

  const revenueCandidateGrosz = Math.max(
    0,
    receivedRevenueGrosz - refundsInYearGrosz
  );
  const incomeCandidateGrosz = revenueCandidateGrosz - deductibleCostsGrosz;

  for (const value of [
    receivedRevenueGrosz,
    refundsInYearGrosz,
    deductibleCostsGrosz,
    revenueCandidateGrosz,
    Math.abs(incomeCandidateGrosz)
  ]) {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Accounting total exceeded safe integer range');
    }
  }

  return {
    year,
    pitForm: 'PIT-36',
    source: 'DZIALALNOSC_NIEREJESTROWANA',
    receivedRevenueGrosz,
    refundsInYearGrosz,
    revenueCandidateGrosz,
    deductibleCostsGrosz,
    incomeCandidateGrosz,
    reviewRequired: reviewReasons.size > 0,
    reviewReasons: [...reviewReasons],
    note:
      'This prepares the działalność nierejestrowana line. Final PIT liability requires all taxpayer income, deductions and current filing rules.',
    arithmetic: {
      representation: 'INTEGER_GROSZ',
      computationalErrorPln: '0.000',
      requestedMaximumErrorPln: '0.001'
    }
  };
}
